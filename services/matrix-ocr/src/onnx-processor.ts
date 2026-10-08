import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  MATRIX_OCR_PROTOCOL_VERSION,
  MatrixOcrProcessorError,
  type MatrixOcrBlock,
  type MatrixOcrProcessInput,
  type MatrixOcrProcessor,
  type MatrixOcrResponse,
} from "./contracts.js";
import { prepareDocumentPages } from "./document-pages.js";
import { resolveModelPaths } from "./model-registry.js";
import { OnnxOcrEngine, type OcrTextLine } from "./onnx-engine.js";
import type { MatrixStructureClient } from "./structure-client.js";

function normalizeBox(
  line: OcrTextLine,
  width: number,
  height: number,
): [number, number, number, number] | null {
  if (width <= 0 || height <= 0) return null;
  const x0 = Math.max(0, Math.min(1, line.box.x / width));
  const y0 = Math.max(0, Math.min(1, line.box.y / height));
  const x1 = Math.max(
    0,
    Math.min(1, (line.box.x + line.box.width) / width),
  );
  const y1 = Math.max(
    0,
    Math.min(1, (line.box.y + line.box.height) / height),
  );
  return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
}

export class OnnxMatrixOcrProcessor implements MatrixOcrProcessor {
  readonly modelVersion: string;

  private constructor(
    private readonly engine: OnnxOcrEngine,
    modelVersion: string,
    private readonly dpi: number,
    private readonly maxPages: number,
    private readonly structureClient?: MatrixStructureClient,
  ) {
    this.modelVersion = modelVersion;
  }

  static async create(input: {
    resourcesRoot: string;
    dpi: number;
    maxPages: number;
    intraOpThreads?: number;
    structureClient?: MatrixStructureClient;
  }): Promise<OnnxMatrixOcrProcessor> {
    const models = await resolveModelPaths(input.resourcesRoot);
    const engine = new OnnxOcrEngine(
      models,
      Math.max(1, input.intraOpThreads ?? 1),
    );
    await engine.init();
    return new OnnxMatrixOcrProcessor(
      engine,
      models.version,
      input.dpi,
      input.maxPages,
      input.structureClient,
    );
  }

  async checkReady(): Promise<boolean> {
    return true;
  }

  async getCapabilities(): Promise<{
    tableStructure: boolean;
    formulaStructure: boolean;
  }> {
    if (!this.structureClient) {
      return { tableStructure: false, formulaStructure: false };
    }
    try {
      return await this.structureClient.checkReady();
    } catch {
      return { tableStructure: false, formulaStructure: false };
    }
  }

  async process(input: MatrixOcrProcessInput): Promise<MatrixOcrResponse> {
    const pagesDir = join(input.workDir, "pages");
    await mkdir(pagesDir, { recursive: true });
    const prepared = await prepareDocumentPages({
      sourcePath: input.sourcePath,
      mediaType: input.mediaType,
      outputDir: pagesDir,
      dpi: this.dpi,
      maxPages: this.maxPages,
      signal: input.signal,
    });
    const pages = [];
    for (const page of prepared) {
      if (input.signal.aborted) {
        throw new DOMException("OCR request aborted", "AbortError");
      }
      const recognized = await this.engine.recognizePage(
        page.imagePath,
        page.physicalPageNumber - 1,
        input.signal,
      );
      let blocks: MatrixOcrBlock[] = recognized.lines.map((line, index) => ({
        block_index: index,
        reading_order: index,
        kind: "text",
        text: line.text,
        bbox: normalizeBox(line, recognized.width, recognized.height),
        confidence: Number.isFinite(line.score)
          ? Math.max(0, Math.min(1, line.score))
          : null,
        structure: null,
      }));
      if (input.enableTable || input.enableFormula) {
        if (!this.structureClient) {
          throw new MatrixOcrProcessorError(
            503,
            "STRUCTURE_UNAVAILABLE",
            "Requested document structure analysis is unavailable",
          );
        }
        const structured = await this.structureClient.analyze({
          imagePath: page.imagePath,
          enableTable: input.enableTable,
          enableFormula: input.enableFormula,
          signal: input.signal,
        });
        blocks = mergeStructuredBlocks(blocks, structured);
      }
      pages.push({
        physical_page_number: page.physicalPageNumber,
        scan_page_number: page.scanPageNumber,
        printed_page_label: null,
        width_points: page.widthPoints,
        height_points: page.heightPoints,
        rotation_degrees: ((page.rotationDegrees +
          recognized.rotationDegrees) % 360) as 0 | 90 | 180 | 270,
        text: blocks.map((block) => block.text).join("\n"),
        blocks,
      });
    }
    return {
      version: MATRIX_OCR_PROTOCOL_VERSION,
      model_version: this.modelVersion,
      pages,
    };
  }

  async close(): Promise<void> {
    await this.engine.dispose();
  }
}

export { normalizeBox };

function centerInside(
  candidate: MatrixOcrBlock["bbox"],
  container: MatrixOcrBlock["bbox"],
): boolean {
  if (!candidate || !container) return false;
  const centerX = (candidate[0] + candidate[2]) / 2;
  const centerY = (candidate[1] + candidate[3]) / 2;
  return (
    container[0] <= centerX &&
    centerX <= container[2] &&
    container[1] <= centerY &&
    centerY <= container[3]
  );
}

export function mergeStructuredBlocks(
  textBlocks: MatrixOcrBlock[],
  structuredBlocks: MatrixOcrBlock[],
): MatrixOcrBlock[] {
  const retained = textBlocks.filter(
    (textBlock) =>
      !structuredBlocks.some((structured) =>
        centerInside(textBlock.bbox, structured.bbox),
      ),
  );
  const merged = [...retained, ...structuredBlocks].sort((left, right) => {
    const leftBox = left.bbox;
    const rightBox = right.bbox;
    if (!leftBox) return rightBox ? 1 : 0;
    if (!rightBox) return -1;
    return leftBox[1] - rightBox[1] || leftBox[0] - rightBox[0];
  });
  return merged.map((block, index) => ({
    ...block,
    block_index: index,
    reading_order: index,
  }));
}
