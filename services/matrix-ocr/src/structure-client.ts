import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import {
  MatrixOcrProcessorError,
  type MatrixOcrBlock,
  type MatrixOcrBlockStructure,
  type MatrixOcrTableCell,
} from "./contracts.js";

const PROTOCOL_VERSION = "matrix-structure-http-v1";

export interface MatrixStructureClient {
  checkReady(): Promise<{
    tableStructure: boolean;
    formulaStructure: boolean;
  }>;
  analyze(input: {
    imagePath: string;
    enableTable: boolean;
    enableFormula: boolean;
    signal: AbortSignal;
  }): Promise<MatrixOcrBlock[]>;
}

type ClientConfig = {
  endpoint: string;
  token: string;
  requestTimeoutSeconds: number;
  maxResponseBytes: number;
  maxUploadBytes: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const number = finiteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} is outside its allowed range`);
  }
  return number;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error(`${label} must be bounded text`);
  }
  return value;
}

function parseBbox(value: unknown): MatrixOcrBlock["bbox"] {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("structure bbox must contain four coordinates");
  }
  const [x0, y0, x1, y1] = value.map((item, index) =>
    finiteNumber(item, `bbox[${index}]`),
  );
  if (
    x0! < 0 ||
    y0! < 0 ||
    x1! > 1 ||
    y1! > 1 ||
    x0! >= x1! ||
    y0! >= y1!
  ) {
    throw new Error("structure bbox is invalid");
  }
  return [x0!, y0!, x1!, y1!];
}

function parseStructure(
  value: unknown,
  kind: "table" | "formula",
): MatrixOcrBlockStructure {
  if (!isRecord(value) || value.type !== kind) {
    throw new Error("structure type does not match the block kind");
  }
  if (kind === "formula") {
    const latex = boundedText(value.latex, "formula latex", 100_000).trim();
    if (!latex) throw new Error("formula latex is empty");
    return { type: "formula", latex };
  }
  const rows = boundedInteger(value.rows, "table rows", 1, 10_000);
  const columns = boundedInteger(value.columns, "table columns", 1, 10_000);
  if (!Array.isArray(value.cells) || value.cells.length > 100_000) {
    throw new Error("table cells are invalid");
  }
  const occupied = new Set<string>();
  const cells: MatrixOcrTableCell[] = value.cells.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`table cell ${index} is invalid`);
    const row = boundedInteger(raw.row, `table cell ${index} row`, 0, rows - 1);
    const column = boundedInteger(
      raw.column,
      `table cell ${index} column`,
      0,
      columns - 1,
    );
    const rowSpan = boundedInteger(
      raw.row_span,
      `table cell ${index} row span`,
      1,
      rows,
    );
    const columnSpan = boundedInteger(
      raw.column_span,
      `table cell ${index} column span`,
      1,
      columns,
    );
    if (row + rowSpan > rows || column + columnSpan > columns) {
      throw new Error(`table cell ${index} exceeds table bounds`);
    }
    for (let coveredRow = row; coveredRow < row + rowSpan; coveredRow += 1) {
      for (
        let coveredColumn = column;
        coveredColumn < column + columnSpan;
        coveredColumn += 1
      ) {
        const key = `${coveredRow}:${coveredColumn}`;
        if (occupied.has(key)) throw new Error("table cells overlap");
        occupied.add(key);
      }
    }
    return {
      row,
      column,
      row_span: rowSpan,
      column_span: columnSpan,
      text: boundedText(raw.text, `table cell ${index} text`, 200_000),
    };
  });
  if (!cells.length) throw new Error("table cells are empty");
  return { type: "table", rows, columns, cells };
}

function parseResponse(payload: unknown): MatrixOcrBlock[] {
  if (!isRecord(payload) || payload.version !== PROTOCOL_VERSION) {
    throw new Error("structure response version is invalid");
  }
  boundedText(payload.model_version, "structure model version", 256);
  boundedInteger(payload.width_pixels, "structure width", 1, 100_000);
  boundedInteger(payload.height_pixels, "structure height", 1, 100_000);
  if (!Array.isArray(payload.blocks) || payload.blocks.length > 10_000) {
    throw new Error("structure blocks are invalid");
  }
  return payload.blocks.map((raw, index) => {
    if (!isRecord(raw) || (raw.kind !== "table" && raw.kind !== "formula")) {
      throw new Error(`structure block ${index} kind is invalid`);
    }
    const kind = raw.kind;
    const confidence =
      raw.confidence === null
        ? null
        : finiteNumber(raw.confidence, `structure block ${index} confidence`);
    if (confidence !== null && (confidence < 0 || confidence > 1)) {
      throw new Error(`structure block ${index} confidence is invalid`);
    }
    return {
      block_index: boundedInteger(
        raw.structure_index,
        `structure block ${index} index`,
        0,
        9_999,
      ),
      reading_order: boundedInteger(
        raw.reading_order,
        `structure block ${index} order`,
        0,
        9_999,
      ),
      kind,
      text: boundedText(raw.text, `structure block ${index} text`, 1_000_000),
      bbox: parseBbox(raw.bbox),
      confidence,
      structure: parseStructure(raw.structure, kind),
    };
  });
}

async function readJsonBounded(
  response: Response,
  maxResponseBytes: number,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    throw new Error("structure response exceeds configured size");
  }
  if (!response.body) throw new Error("structure response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new Error("structure response exceeds configured size");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks, total).toString("utf8");
  return JSON.parse(body) as unknown;
}

export class HttpStructureClient implements MatrixStructureClient {
  constructor(private readonly config: ClientConfig) {}

  async checkReady(): Promise<{
    tableStructure: boolean;
    formulaStructure: boolean;
  }> {
    try {
      const response = await fetch(`${this.config.endpoint}/v1/structure/health`, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return { tableStructure: false, formulaStructure: false };
      const payload = await readJsonBounded(response, this.config.maxResponseBytes);
      if (!isRecord(payload) || payload.version !== PROTOCOL_VERSION) {
        return { tableStructure: false, formulaStructure: false };
      }
      const capabilities = payload.capabilities;
      return {
        tableStructure:
          isRecord(capabilities) && capabilities.table_structure === true,
        formulaStructure:
          isRecord(capabilities) && capabilities.formula_structure === true,
      };
    } catch {
      return { tableStructure: false, formulaStructure: false };
    }
  }

  async analyze(input: {
    imagePath: string;
    enableTable: boolean;
    enableFormula: boolean;
    signal: AbortSignal;
  }): Promise<MatrixOcrBlock[]> {
    const metadata = await stat(input.imagePath);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > this.config.maxUploadBytes
    ) {
      throw new MatrixOcrProcessorError(
        413,
        "STRUCTURE_PAGE_LIMIT",
        "Rendered page exceeds the structure service limit",
      );
    }
    const body = await readFile(input.imagePath);
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.config.requestTimeoutSeconds * 1_000),
    ]);
    try {
      const response = await fetch(`${this.config.endpoint}/v1/structure/analyze`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "image/png",
          "Content-Length": String(body.length),
          "X-Structure-Source-SHA256": createHash("sha256")
            .update(body)
            .digest("hex"),
          "X-Structure-Enable-Table": String(input.enableTable),
          "X-Structure-Enable-Formula": String(input.enableFormula),
        },
        body,
        signal,
      });
      const payload = await readJsonBounded(response, this.config.maxResponseBytes);
      if (!response.ok) {
        throw new MatrixOcrProcessorError(
          response.status === 429 || response.status === 503 ? 503 : 502,
          "STRUCTURE_UNAVAILABLE",
          "Requested document structure analysis is unavailable",
        );
      }
      try {
        return parseResponse(payload);
      } catch {
        throw new MatrixOcrProcessorError(
          502,
          "STRUCTURE_INVALID_RESPONSE",
          "Structure service returned an invalid response",
        );
      }
    } catch (error) {
      if (error instanceof MatrixOcrProcessorError || input.signal.aborted) {
        throw error;
      }
      throw new MatrixOcrProcessorError(
        503,
        "STRUCTURE_UNAVAILABLE",
        "Requested document structure analysis is unavailable",
      );
    }
  }
}

export { parseResponse };
