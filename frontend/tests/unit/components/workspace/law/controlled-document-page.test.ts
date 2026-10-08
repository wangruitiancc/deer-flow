import { describe, expect, it } from "@rstest/core";

import {
  normalizeDocumentRotation,
  pdfBlockScrollTarget,
  pdfRenderScale,
  resolvePdfViewportRotation,
  shouldShowOcrOverlay,
} from "@/components/workspace/law/controlled-document-page";

describe("controlled document page rotation", () => {
  it("normalizes arbitrary angles to supported right angles", () => {
    expect(normalizeDocumentRotation(-90)).toBe(270);
    expect(normalizeDocumentRotation(450)).toBe(90);
    expect(normalizeDocumentRotation(45)).toBe(0);
  });

  it("composes intrinsic PDF rotation with the OCR orientation correction", () => {
    expect(resolvePdfViewportRotation(90, 270)).toBe(0);
    expect(resolvePdfViewportRotation(270, 180)).toBe(90);
  });

  it("shows OCR boxes only for the orientation they were recognized against", () => {
    expect(shouldShowOcrOverlay(90, 90)).toBe(true);
    expect(shouldShowOcrOverlay(180, 90)).toBe(false);
  });

  it("centers a selected source block within the protected PDF viewport", () => {
    expect(pdfBlockScrollTarget(
      { x0: 0.4, y0: 0.7, x1: 0.6, y1: 0.8 },
      { width: 600, height: 1200, left: 12, top: 12 },
      { width: 400, height: 500, scrollWidth: 624, scrollHeight: 1224 },
    )).toEqual({ left: 112, top: 662 });
    expect(pdfBlockScrollTarget(
      { x0: 0, y0: 0, x1: 0.1, y1: 0.1 },
      { width: 600, height: 1200, left: 12, top: 12 },
      { width: 400, height: 500, scrollWidth: 624, scrollHeight: 1224 },
    )).toEqual({ left: 0, top: 0 });
  });

  it("enlarges the source while bounding the rendered canvas", () => {
    expect(pdfRenderScale({ width: 612, height: 792 }, 588, 2, 1).scale)
      .toBeCloseTo(588 / 612);
    const enlarged = pdfRenderScale({ width: 612, height: 792 }, 588, 2, 3);
    expect(enlarged.scale).toBeCloseTo(4096 / (792 * 2));
    expect(792 * enlarged.scale * enlarged.outputScale).toBeLessThanOrEqual(4096);
  });
});
