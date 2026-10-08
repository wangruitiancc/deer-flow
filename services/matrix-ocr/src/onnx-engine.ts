import { readFile } from "node:fs/promises";

import type * as Ort from "onnxruntime-node";
import sharp from "sharp";

import type { MatrixOcrModelPaths } from "./model-registry.js";

// Official non-Windows ONNX Runtime builds enable telemetry by default. Legal
// evidence processing is private by design, so disable it before the native
// runtime module is loaded. This is deliberately not configurable.
process.env.ORT_DISABLE_TELEMETRY = "1";

let onnxRuntime: Promise<typeof import("onnxruntime-node")> | undefined;

function loadOnnxRuntime(): Promise<typeof import("onnxruntime-node")> {
  onnxRuntime ??= import("onnxruntime-node");
  return onnxRuntime;
}

export interface OcrTextLine {
  text: string;
  score: number;
  box: { x: number; y: number; width: number; height: number };
}

export interface OcrPageResult {
  pageIndex: number;
  width: number;
  height: number;
  rotationDegrees: 0 | 90 | 180 | 270;
  lines: OcrTextLine[];
}

interface RgbImage {
  data: Uint8Array;
  width: number;
  height: number;
}

interface OrientationCandidate {
  rotationDegrees: 0 | 90 | 180 | 270;
  image: RgbImage;
  lines: OcrTextLine[];
  flippedLines: number;
  scoreSum: number;
}

const DET_LIMIT_SIDE = 960;
const DET_THRESH = 0.3;
const DET_BOX_THRESH = 0.6;
const REC_IMG_H = 48;
const CLS_IMG_W = 160;
const CLS_IMG_H = 80;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("OCR request aborted", "AbortError");
}

async function loadRgb(imagePath: string): Promise<RgbImage> {
  const { data, info } = await sharp(imagePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function rotateRgb(
  image: RgbImage,
  rotationDegrees: 90 | 180 | 270,
): Promise<RgbImage> {
  const rotated = await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .rotate(rotationDegrees)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(rotated.data),
    width: rotated.info.width,
    height: rotated.info.height,
  };
}

export function detResize(
  width: number,
  height: number,
): { rw: number; rh: number; ratioW: number; ratioH: number } {
  let ratio = 1;
  if (Math.max(width, height) > DET_LIMIT_SIDE) {
    ratio = DET_LIMIT_SIDE / Math.max(width, height);
  }
  const rh = Math.max(32, Math.round((height * ratio) / 32) * 32);
  const rw = Math.max(32, Math.round((width * ratio) / 32) * 32);
  return { rw, rh, ratioW: rw / width, ratioH: rh / height };
}

async function toDetTensor(
  image: RgbImage,
  width: number,
  height: number,
): Promise<Ort.Tensor> {
  const ort = await loadOnnxRuntime();
  const resized = await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const area = width * height;
  const chw = new Float32Array(3 * area);
  for (let index = 0; index < area; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = resized[index * 3 + (2 - channel)] / 255;
      chw[channel * area + index] =
        (value - mean[channel]!) / std[channel]!;
    }
  }
  return new ort.Tensor("float32", chw, [1, 3, height, width]);
}

export class OnnxOcrEngine {
  private det?: Ort.InferenceSession;
  private cls?: Ort.InferenceSession;
  private rec?: Ort.InferenceSession;
  private dictionary: string[] = [];

  constructor(
    private readonly models: MatrixOcrModelPaths,
    private readonly intraOpThreads: number,
  ) {}

  async init(): Promise<void> {
    const ort = await loadOnnxRuntime();
    const options: Ort.InferenceSession.SessionOptions = {
      graphOptimizationLevel: "all",
      executionMode: "sequential",
      interOpNumThreads: 1,
      intraOpNumThreads: this.intraOpThreads,
    };
    this.det = await ort.InferenceSession.create(this.models.det, options);
    this.rec = await ort.InferenceSession.create(this.models.rec, options);
    this.cls = await ort.InferenceSession.create(this.models.cls, options);
    const dictionary = await readFile(this.models.dict, "utf8");
    this.dictionary = [
      "<blank>",
      ...dictionary.split(/\r?\n/).filter((line) => line.length > 0),
    ];
  }

  async recognizePage(
    imagePath: string,
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<OcrPageResult> {
    if (!this.det || !this.rec || !this.cls) {
      throw new Error("ONNX OCR engine is not initialized");
    }
    throwIfAborted(signal);
    const image = await loadRgb(imagePath);
    const initial = await this.recognizeOrientation(image, 0, signal);
    let selected = initial;
    if (
      initial.lines.length === 0 ||
      initial.flippedLines > initial.lines.length / 2
    ) {
      const candidates = [initial];
      for (const rotation of [90, 180, 270] as const) {
        throwIfAborted(signal);
        const rotated = await rotateRgb(image, rotation);
        candidates.push(
          await this.recognizeOrientation(rotated, rotation, signal),
        );
      }
      selected = candidates.sort(compareOrientationCandidates)[0]!;
    }
    return {
      pageIndex,
      width: selected.image.width,
      height: selected.image.height,
      rotationDegrees: selected.rotationDegrees,
      lines: selected.lines,
    };
  }

  private async recognizeOrientation(
    image: RgbImage,
    rotationDegrees: 0 | 90 | 180 | 270,
    signal?: AbortSignal,
  ): Promise<OrientationCandidate> {
    const boxes = await this.detect(image);
    throwIfAborted(signal);
    const lines: OcrTextLine[] = [];
    let flippedLines = 0;
    let scoreSum = 0;
    for (const box of boxes) {
      throwIfAborted(signal);
      const crop = await this.cropBox(image, box);
      if (!crop) continue;
      const oriented = await this.applyTextLineOrientation(crop);
      const recognized = await this.recognize(oriented.image);
      if (recognized.text.trim()) {
        lines.push({ ...recognized, box });
        scoreSum += recognized.score;
        if (oriented.rotated180) flippedLines += 1;
      }
    }
    return {
      rotationDegrees,
      image,
      lines,
      flippedLines,
      scoreSum,
    };
  }

  private async detect(image: RgbImage): Promise<OcrTextLine["box"][]> {
    const { rw, rh, ratioW, ratioH } = detResize(
      image.width,
      image.height,
    );
    const tensor = await toDetTensor(image, rw, rh);
    const output = await this.det!.run({ [this.det!.inputNames[0]!]: tensor });
    const probability = output[this.det!.outputNames[0]!]!;
    const map = probability.data as Float32Array;
    const binary = new Uint8Array(rw * rh);
    for (let index = 0; index < binary.length; index += 1) {
      binary[index] = map[index]! > DET_THRESH ? 1 : 0;
    }

    const visited = new Uint8Array(binary.length);
    const boxes: OcrTextLine["box"][] = [];
    const stack: number[] = [];
    for (let start = 0; start < binary.length; start += 1) {
      if (!binary[start] || visited[start]) continue;
      let minX = rw;
      let minY = rh;
      let maxX = 0;
      let maxY = 0;
      let count = 0;
      let probabilitySum = 0;
      stack.push(start);
      visited[start] = 1;
      while (stack.length) {
        const index = stack.pop()!;
        const x = index % rw;
        const y = (index - x) / rw;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        count += 1;
        probabilitySum += map[index]!;
        const neighbors = [index - 1, index + 1, index - rw, index + rw];
        const expectedX = [x - 1, x + 1, x, x];
        for (let offset = 0; offset < neighbors.length; offset += 1) {
          const neighbor = neighbors[offset]!;
          if (neighbor < 0 || neighbor >= binary.length) continue;
          if (offset < 2 && expectedX[offset] !== neighbor % rw) continue;
          if (binary[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            stack.push(neighbor);
          }
        }
      }
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      if (count < 12 || width < 4 || height < 4) continue;
      if (probabilitySum / count < DET_BOX_THRESH) continue;
      const area = width * height;
      const perimeter = 2 * (width + height);
      const distance = perimeter > 0 ? (area * 1.2) / perimeter : 0;
      const verticalDistance = distance * 0.6;
      const x = Math.max(0, Math.round((minX - distance) / ratioW));
      const y = Math.max(0, Math.round((minY - verticalDistance) / ratioH));
      const boxWidth = Math.min(
        image.width - x,
        Math.round((width + 2 * distance) / ratioW),
      );
      const boxHeight = Math.min(
        image.height - y,
        Math.round((height + 2 * verticalDistance) / ratioH),
      );
      if (boxWidth > 0 && boxHeight > 0) {
        boxes.push({ x, y, width: boxWidth, height: boxHeight });
      }
    }
    boxes.sort((left, right) =>
      Math.abs(left.y - right.y) > 10
        ? left.y - right.y
        : left.x - right.x,
    );
    return boxes;
  }

  private async cropBox(
    image: RgbImage,
    box: OcrTextLine["box"],
  ): Promise<RgbImage | null> {
    if (box.width < 3 || box.height < 3) return null;
    const crop = await sharp(Buffer.from(image.data), {
      raw: { width: image.width, height: image.height, channels: 3 },
    })
      .extract({
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
      })
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch(() => null);
    if (!crop) return null;
    return {
      data: new Uint8Array(crop.data),
      width: crop.info.width,
      height: crop.info.height,
    };
  }

  private async applyTextLineOrientation(
    crop: RgbImage,
  ): Promise<{ image: RgbImage; rotated180: boolean }> {
    const ort = await loadOnnxRuntime();
    const resized = await sharp(Buffer.from(crop.data), {
      raw: { width: crop.width, height: crop.height, channels: 3 },
    })
      .resize(CLS_IMG_W, CLS_IMG_H, { fit: "fill" })
      .raw()
      .toBuffer();
    const area = CLS_IMG_W * CLS_IMG_H;
    const chw = new Float32Array(3 * area);
    for (let index = 0; index < area; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        chw[channel * area + index] =
          (resized[index * 3 + (2 - channel)] / 255 - 0.5) / 0.5;
      }
    }
    const tensor = new ort.Tensor("float32", chw, [
      1,
      3,
      CLS_IMG_H,
      CLS_IMG_W,
    ]);
    const output = await this.cls!.run({
      [this.cls!.inputNames[0]!]: tensor,
    });
    const scores = output[this.cls!.outputNames[0]!]!.data as Float32Array;
    if (scores.length < 2 || scores[1]! <= scores[0]! || scores[1]! <= 0.9) {
      return { image: crop, rotated180: false };
    }
    const rotated = await sharp(Buffer.from(crop.data), {
      raw: { width: crop.width, height: crop.height, channels: 3 },
    })
      .rotate(180)
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      image: {
        data: new Uint8Array(rotated.data),
        width: rotated.info.width,
        height: rotated.info.height,
      },
      rotated180: true,
    };
  }

  private async recognize(
    crop: RgbImage,
  ): Promise<{ text: string; score: number }> {
    const ort = await loadOnnxRuntime();
    const targetWidth = Math.min(
      3_200,
      Math.max(16, Math.round((crop.width * REC_IMG_H) / crop.height)),
    );
    const resized = await sharp(Buffer.from(crop.data), {
      raw: { width: crop.width, height: crop.height, channels: 3 },
    })
      .resize(targetWidth, REC_IMG_H, { fit: "fill" })
      .raw()
      .toBuffer();
    const area = targetWidth * REC_IMG_H;
    const chw = new Float32Array(3 * area);
    for (let index = 0; index < area; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        chw[channel * area + index] =
          (resized[index * 3 + (2 - channel)] / 255 - 0.5) / 0.5;
      }
    }
    const tensor = new ort.Tensor("float32", chw, [
      1,
      3,
      REC_IMG_H,
      targetWidth,
    ]);
    const output = await this.rec!.run({
      [this.rec!.inputNames[0]!]: tensor,
    });
    const logits = output[this.rec!.outputNames[0]!]!;
    const [, timeSteps, classes] = logits.dims as number[];
    const data = logits.data as Float32Array;
    let previous = -1;
    let text = "";
    let scoreSum = 0;
    let scoreCount = 0;
    for (let time = 0; time < timeSteps!; time += 1) {
      let best = 0;
      let bestValue = -Infinity;
      for (let character = 0; character < classes!; character += 1) {
        const value = data[time * classes! + character]!;
        if (value > bestValue) {
          bestValue = value;
          best = character;
        }
      }
      if (best !== 0 && best !== previous) {
        const character =
          best < this.dictionary.length
            ? this.dictionary[best]
            : best === this.dictionary.length
              ? " "
              : undefined;
        if (character && character !== "<blank>") {
          text += character;
          scoreSum += bestValue;
          scoreCount += 1;
        }
      }
      previous = best;
    }
    return { text, score: scoreCount ? scoreSum / scoreCount : 0 };
  }

  async dispose(): Promise<void> {
    await this.det?.release();
    await this.cls?.release();
    await this.rec?.release();
  }
}

function compareOrientationCandidates(
  left: OrientationCandidate,
  right: OrientationCandidate,
): number {
  if (left.lines.length !== right.lines.length) {
    return right.lines.length - left.lines.length;
  }
  if (left.flippedLines !== right.flippedLines) {
    return left.flippedLines - right.flippedLines;
  }
  if (left.scoreSum !== right.scoreSum) {
    return right.scoreSum - left.scoreSum;
  }
  return left.rotationDegrees - right.rotationDegrees;
}
