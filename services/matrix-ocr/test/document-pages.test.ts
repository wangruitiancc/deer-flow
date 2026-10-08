import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { degrees, PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { prepareDocumentPages } from "../src/document-pages.js";
import { mergeStructuredBlocks, normalizeBox } from "../src/onnx-processor.js";

test("prepares one image page with normalized orientation", async () => {
  const root = await mkdtemp(join(tmpdir(), "matrix-ocr-image-"));
  try {
    const source = join(root, "source.png");
    await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toFile(source);
    const pages = await prepareDocumentPages({
      sourcePath: source,
      mediaType: "image/png",
      outputDir: root,
      dpi: 144,
      maxPages: 2,
      signal: new AbortController().signal,
    });
    assert.equal(pages.length, 1);
    assert.equal(pages[0]!.widthPoints, 320);
    assert.equal(pages[0]!.heightPoints, 180);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rasterizes every physical PDF page and enforces the page limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "matrix-ocr-pdf-"));
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    pdf.addPage([300, 400]).setRotation(degrees(90));
    const source = join(root, "source.pdf");
    await writeFile(source, await pdf.save());
    const pages = await prepareDocumentPages({
      sourcePath: source,
      mediaType: "application/pdf",
      outputDir: root,
      dpi: 72,
      maxPages: 2,
      signal: new AbortController().signal,
    });
    assert.deepEqual(
      pages.map((page) => page.physicalPageNumber),
      [1, 2],
    );
    assert.equal(pages[0]!.widthPoints, 612);
    assert.equal(pages[1]!.rotationDegrees, 90);
    await assert.rejects(
      prepareDocumentPages({
        sourcePath: source,
        mediaType: "application/pdf",
        outputDir: root,
        dpi: 72,
        maxPages: 1,
        signal: new AbortController().signal,
      }),
      /page count/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extracts every TIFF page and enforces the shared page limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "matrix-ocr-tiff-"));
  try {
    const source = join(root, "source.tiff");
    await sharp({
      create: {
        width: 320,
        height: 360,
        pageHeight: 180,
        channels: 3,
        background: "white",
      },
    })
      .tiff({ compression: "lzw" })
      .toFile(source);
    const pages = await prepareDocumentPages({
      sourcePath: source,
      mediaType: "image/tiff",
      outputDir: root,
      dpi: 144,
      maxPages: 2,
      signal: new AbortController().signal,
    });
    assert.equal(pages.length, 2);
    assert.deepEqual(
      pages.map((page) => page.physicalPageNumber),
      [1, 2],
    );
    await assert.rejects(
      prepareDocumentPages({
        sourcePath: source,
        mediaType: "image/tiff",
        outputDir: root,
        dpi: 144,
        maxPages: 1,
        signal: new AbortController().signal,
      }),
      /page count/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizes and clamps OCR boxes", () => {
  assert.deepEqual(
    normalizeBox(
      {
        text: "fixture",
        score: 0.9,
        box: { x: -5, y: 10, width: 60, height: 20 },
      },
      100,
      100,
    ),
    [0, 0.1, 0.55, 0.3],
  );
});

test("structured regions replace covered OCR lines without duplicating text", () => {
  const merged = mergeStructuredBlocks(
    [
      {
        block_index: 0,
        reading_order: 0,
        kind: "text",
        text: "outside",
        bbox: [0.1, 0.1, 0.2, 0.2],
        confidence: 0.9,
        structure: null,
      },
      {
        block_index: 1,
        reading_order: 1,
        kind: "text",
        text: "duplicate table text",
        bbox: [0.2, 0.4, 0.3, 0.5],
        confidence: 0.9,
        structure: null,
      },
    ],
    [
      {
        block_index: 0,
        reading_order: 0,
        kind: "table",
        text: "A\tB",
        bbox: [0.1, 0.3, 0.9, 0.7],
        confidence: 0.8,
        structure: {
          type: "table",
          rows: 1,
          columns: 2,
          cells: [
            { row: 0, column: 0, row_span: 1, column_span: 1, text: "A" },
            { row: 0, column: 1, row_span: 1, column_span: 1, text: "B" },
          ],
        },
      },
    ],
  );
  assert.deepEqual(
    merged.map((block) => [block.kind, block.text, block.block_index]),
    [
      ["text", "outside", 0],
      ["table", "A\tB", 1],
    ],
  );
});
