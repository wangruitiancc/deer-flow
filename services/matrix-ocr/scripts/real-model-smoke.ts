import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { degrees, PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { OnnxMatrixOcrProcessor } from "../src/onnx-processor.js";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function assertResult(
  label: string,
  result: Awaited<ReturnType<OnnxMatrixOcrProcessor["process"]>>,
  expectedPages = 1,
): void {
  assert.equal(result.version, "matrix-ocr-http-v1");
  assert.equal(result.pages.length, expectedPages);
  for (const page of result.pages) {
    assert(
      page.blocks.length > 0,
      `${label} page ${page.physical_page_number} produced no OCR blocks`,
    );
    for (const block of page.blocks) {
      assert(block.text.trim(), `${label} produced an empty block`);
      assert(block.bbox, `${label} block has no bbox`);
      const [x0, y0, x1, y1] = block.bbox!;
      assert(0 <= x0 && x0 < x1 && x1 <= 1);
      assert(0 <= y0 && y0 < y1 && y1 <= 1);
    }
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "matrix-ocr-real-smoke-"));
  const processor = await OnnxMatrixOcrProcessor.create({
    resourcesRoot: join(serviceRoot, "resources"),
    dpi: 144,
    maxPages: 4,
    intraOpThreads: 2,
  });
  try {
    const imagePath = join(root, "synthetic.png");
    const svg = `
      <svg width="1400" height="700" xmlns="http://www.w3.org/2000/svg">
        <rect width="1400" height="700" fill="white"/>
        <text x="90" y="180" font-family="PingFang SC, Noto Sans CJK SC, sans-serif" font-size="72" fill="black">合同编号 2026</text>
        <text x="90" y="350" font-family="Arial, sans-serif" font-size="72" fill="black">PAYMENT WITHIN 30 DAYS</text>
        <text x="90" y="520" font-family="PingFang SC, Noto Sans CJK SC, sans-serif" font-size="72" fill="black">金额 128,000 元</text>
      </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(imagePath);

    const imageResult = await processor.process({
      sourcePath: imagePath,
      mediaType: "image/png",
      language: "auto",
      enableTable: false,
      enableFormula: false,
      signal: new AbortController().signal,
      workDir: join(root, "image-work"),
    });
    assertResult("image", imageResult);

    const jpegPath = join(root, "synthetic.jpg");
    await sharp(imagePath).jpeg({ quality: 90 }).toFile(jpegPath);
    const jpegResult = await processor.process({
      sourcePath: jpegPath,
      mediaType: "image/jpeg",
      language: "auto",
      enableTable: false,
      enableFormula: false,
      signal: new AbortController().signal,
      workDir: join(root, "jpeg-work"),
    });
    assertResult("JPEG", jpegResult);

    const tiffPath = join(root, "synthetic.tiff");
    await sharp(imagePath).tiff({ compression: "lzw" }).toFile(tiffPath);
    const tiffResult = await processor.process({
      sourcePath: tiffPath,
      mediaType: "image/tiff",
      language: "auto",
      enableTable: false,
      enableFormula: false,
      signal: new AbortController().signal,
      workDir: join(root, "tiff-work"),
    });
    assertResult("TIFF", tiffResult);

    const multiTiffPath = join(root, "synthetic-multipage.tiff");
    const sourcePng = await readFile(imagePath);
    await sharp({
      create: {
        width: 1400,
        height: 1400,
        pageHeight: 700,
        channels: 3,
        background: "white",
      },
    })
      .composite([
        { input: sourcePng, top: 0, left: 0 },
        { input: sourcePng, top: 700, left: 0 },
      ])
      .tiff({ compression: "lzw" })
      .toFile(multiTiffPath);
    const multiTiffResult = await processor.process({
      sourcePath: multiTiffPath,
      mediaType: "image/tiff",
      language: "auto",
      enableTable: false,
      enableFormula: false,
      signal: new AbortController().signal,
      workDir: join(root, "multipage-tiff-work"),
    });
    assertResult("multi-page TIFF", multiTiffResult, 2);

    const rawRotationBlocks: number[] = [];
    const rawRotationCorrections: number[] = [];
    for (const rotation of [90, 180, 270]) {
      const rotatedPath = join(root, `synthetic-raw-${rotation}.png`);
      await sharp(imagePath).rotate(rotation).png().toFile(rotatedPath);
      const rotatedResult = await processor.process({
        sourcePath: rotatedPath,
        mediaType: "image/png",
        language: "auto",
        enableTable: false,
        enableFormula: false,
        signal: new AbortController().signal,
        workDir: join(root, `raw-rotation-${rotation}-work`),
      });
      assertResult(`raw ${rotation}-degree image`, rotatedResult);
      rawRotationBlocks.push(rotatedResult.pages[0]!.blocks.length);
      rawRotationCorrections.push(
        rotatedResult.pages[0]!.rotation_degrees,
      );
    }
    assert.deepEqual(rawRotationCorrections, [270, 180, 90]);

    const pdf = await PDFDocument.create();
    for (const rotation of [0, 90, 180, 270]) {
      const sourceRotation = (360 - rotation) % 360;
      const rotatedImage = await sharp(imagePath)
        .rotate(sourceRotation)
        .png()
        .toBuffer();
      const image = await pdf.embedPng(rotatedImage);
      const sideways = rotation === 90 || rotation === 270;
      const width = sideways ? 350 : 700;
      const height = sideways ? 700 : 350;
      const page = pdf.addPage([width, height]);
      page.setRotation(degrees(rotation));
      page.drawImage(image, { x: 0, y: 0, width, height });
    }
    const pdfPath = join(root, "synthetic.pdf");
    await writeFile(pdfPath, await pdf.save());
    const pdfResult = await processor.process({
      sourcePath: pdfPath,
      mediaType: "application/pdf",
      language: "auto",
      enableTable: false,
      enableFormula: false,
      signal: new AbortController().signal,
      workDir: join(root, "pdf-work"),
    });
    assertResult("rotated multi-page PDF", pdfResult, 4);

    process.stdout.write(
      `${JSON.stringify({
        status: "passed",
        model_version: processor.modelVersion,
        image_blocks: imageResult.pages[0]!.blocks.length,
        image_text: imageResult.pages[0]!.text,
        jpeg_blocks: jpegResult.pages[0]!.blocks.length,
        tiff_blocks: tiffResult.pages[0]!.blocks.length,
        multipage_tiff_blocks: multiTiffResult.pages.map(
          (page) => page.blocks.length,
        ),
        raw_rotation_blocks: rawRotationBlocks,
        raw_rotation_corrections: rawRotationCorrections,
        pdf_blocks: pdfResult.pages.map((page) => page.blocks.length),
        pdf_rotations: pdfResult.pages.map((page) => page.rotation_degrees),
      })}\n`,
    );
  } finally {
    await processor.close();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Matrix OCR real-model smoke failed: ${error instanceof Error ? error.stack : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
