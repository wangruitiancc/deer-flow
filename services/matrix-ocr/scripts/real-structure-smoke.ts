import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { OnnxMatrixOcrProcessor } from "../src/onnx-processor.js";
import { HttpStructureClient } from "../src/structure-client.js";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const endpoint = process.env.MATRIX_STRUCTURE_ENDPOINT?.trim();
  const token = process.env.MATRIX_STRUCTURE_HTTP_TOKEN?.trim();
  if (!endpoint || !token || token.length < 24) {
    throw new Error("MATRIX_STRUCTURE_ENDPOINT and a private sidecar token are required");
  }
  const root = await mkdtemp(join(tmpdir(), "matrix-ocr-structure-smoke-"));
  const client = new HttpStructureClient({
    endpoint: endpoint.replace(/\/$/, ""),
    token,
    requestTimeoutSeconds: 180,
    maxResponseBytes: 10_485_760,
    maxUploadBytes: 26_214_400,
  });
  const processor = await OnnxMatrixOcrProcessor.create({
    resourcesRoot: join(serviceRoot, "resources"),
    dpi: 144,
    maxPages: 2,
    intraOpThreads: 2,
    structureClient: client,
  });
  try {
    assert.deepEqual(await processor.getCapabilities(), {
      tableStructure: true,
      formulaStructure: true,
    });
    const sourcePath = join(root, "table-formula.png");
    const svg = `
      <svg width="1400" height="1000" xmlns="http://www.w3.org/2000/svg">
        <rect width="1400" height="1000" fill="white"/>
        <text x="80" y="95" font-family="Arial" font-weight="bold" font-size="46">Contract Payment Schedule</text>
        <g stroke="black" stroke-width="5">
          <line x1="90" y1="180" x2="1310" y2="180"/><line x1="90" y1="290" x2="1310" y2="290"/>
          <line x1="90" y1="410" x2="1310" y2="410"/><line x1="90" y1="530" x2="1310" y2="530"/>
          <line x1="90" y1="650" x2="1310" y2="650"/><line x1="90" y1="180" x2="90" y2="650"/>
          <line x1="430" y1="180" x2="430" y2="650"/><line x1="900" y1="180" x2="900" y2="650"/>
          <line x1="1310" y1="180" x2="1310" y2="650"/>
        </g>
        <g fill="black" font-family="Arial" font-size="42">
          <text x="110" y="255">Item</text><text x="450" y="255">Due date</text><text x="920" y="255">Amount</text>
          <text x="110" y="375">Deposit</text><text x="450" y="375">2026-10-01</text><text x="920" y="375">USD 10,000</text>
          <text x="110" y="495">Delivery</text><text x="450" y="495">2026-11-15</text><text x="920" y="495">USD 25,000</text>
          <text x="110" y="615">Total</text><text x="920" y="615">USD 35,000</text>
        </g>
        <g fill="black" font-family="Times New Roman" font-size="64">
          <text x="120" y="825">E = mc²</text><text x="600" y="825">x² + y² = z²</text>
        </g>
      </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(sourcePath);
    const result = await processor.process({
      sourcePath,
      mediaType: "image/png",
      language: "auto",
      enableTable: true,
      enableFormula: true,
      signal: new AbortController().signal,
      workDir: join(root, "work"),
    });
    const table = result.pages[0]!.blocks.find((block) => block.kind === "table");
    const formula = result.pages[0]!.blocks.find((block) => block.kind === "formula");
    assert.equal(table?.structure?.type, "table");
    if (table?.structure?.type !== "table") throw new Error("table structure missing");
    assert.equal(table.structure.rows, 4);
    assert.equal(table.structure.columns, 3);
    assert.equal(table.structure.cells.length, 12);
    assert.equal(formula?.structure?.type, "formula");
    if (formula?.structure?.type !== "formula") throw new Error("formula structure missing");
    assert(formula.structure.latex.length > 0);
    process.stdout.write(
      `${JSON.stringify({
        status: "passed",
        page_blocks: result.pages[0]!.blocks.length,
        table_rows: table.structure.rows,
        table_columns: table.structure.columns,
        table_cells: table.structure.cells.length,
        formula_latex: formula.structure.latex,
      })}\n`,
    );
  } finally {
    await processor.close();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Matrix OCR structure smoke failed: ${error instanceof Error ? error.stack : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
