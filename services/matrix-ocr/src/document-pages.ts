import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

import type { SupportedMediaType } from "./contracts.js";

export interface PreparedPage {
  physicalPageNumber: number;
  scanPageNumber: number;
  widthPoints: number;
  heightPoints: number;
  rotationDegrees: 0 | 90 | 180 | 270;
  imagePath: string;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("OCR request aborted", "AbortError");
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

async function preparePdf(
  sourcePath: string,
  outputDir: string,
  dpi: number,
  maxPages: number,
  signal: AbortSignal,
): Promise<PreparedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(sourcePath));
  const document = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  try {
    if (document.numPages < 1 || document.numPages > maxPages) {
      throw new Error("OCR source PDF page count is outside the configured limit");
    }
    const pages: PreparedPage[] = [];
    const scale = dpi / 72;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(signal);
      const page = await document.getPage(pageNumber);
      try {
        const points = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const render = page.render({
          // @ts-expect-error napi-rs canvas implements the pdfjs drawing surface.
          canvasContext: context,
          viewport,
        });
        const cancel = () => render.cancel();
        signal.addEventListener("abort", cancel, { once: true });
        try {
          await render.promise;
        } finally {
          signal.removeEventListener("abort", cancel);
        }
        throwIfAborted(signal);
        const imagePath = join(
          outputDir,
          `page-${String(pageNumber).padStart(4, "0")}.png`,
        );
        await sharp(canvas.toBuffer("image/png")).png().toFile(imagePath);
        pages.push({
          physicalPageNumber: pageNumber,
          scanPageNumber: pageNumber,
          widthPoints: points.width,
          heightPoints: points.height,
          rotationDegrees: normalizeRotation(page.rotate),
          imagePath,
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await document.destroy();
  }
}

async function prepareImage(
  sourcePath: string,
  outputDir: string,
  maxPages: number,
  signal: AbortSignal,
): Promise<PreparedPage[]> {
  const metadata = await sharp(sourcePath, { animated: true }).metadata();
  const pageCount = metadata.pages ?? 1;
  if (pageCount < 1 || pageCount > maxPages) {
    throw new Error("OCR source image page count is outside the configured limit");
  }
  const pages: PreparedPage[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    throwIfAborted(signal);
    const imagePath = join(
      outputDir,
      `page-${String(index + 1).padStart(4, "0")}.png`,
    );
    const info = await sharp(sourcePath, { page: index, pages: 1 })
      .rotate()
      .removeAlpha()
      .png()
      .toFile(imagePath);
    pages.push({
      physicalPageNumber: index + 1,
      scanPageNumber: index + 1,
      widthPoints: info.width,
      heightPoints: info.height,
      rotationDegrees: 0,
      imagePath,
    });
  }
  return pages;
}

export async function prepareDocumentPages(input: {
  sourcePath: string;
  mediaType: SupportedMediaType;
  outputDir: string;
  dpi: number;
  maxPages: number;
  signal: AbortSignal;
}): Promise<PreparedPage[]> {
  return input.mediaType === "application/pdf"
    ? preparePdf(
        input.sourcePath,
        input.outputDir,
        input.dpi,
        input.maxPages,
        input.signal,
      )
    : prepareImage(
        input.sourcePath,
        input.outputDir,
        input.maxPages,
        input.signal,
      );
}

export { normalizeRotation };
