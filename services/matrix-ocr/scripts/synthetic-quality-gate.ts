import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { OnnxMatrixOcrProcessor } from "../src/onnx-processor.js";
import {
  evaluateOcrQuality,
  type OcrGoldPage,
  type OcrQualityPolicy,
} from "../src/quality.js";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REGRESSION_POLICY: OcrQualityPolicy = {
  lowConfidenceThreshold: 0.7,
  maxCharacterErrorRate: 0.35,
  minCriticalFieldRecall: 0.67,
  minCitationAnchorRecall: 0.67,
  minMeanConfidence: 0.6,
  maxLowConfidenceBlockRate: 0.6,
  minTableStructureRecall: 1,
  minFormulaStructureRecall: 1,
};

interface SyntheticCase {
  id: string;
  lines: string[];
  criticalFields: string[];
  citationAnchors: string[];
}

function stringArray(value: unknown, label: string): string[] {
  assert(Array.isArray(value) && value.length > 0, `${label} must be non-empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0));
  return value as string[];
}

async function loadCases(): Promise<SyntheticCase[]> {
  const path = join(serviceRoot, "quality", "gold", "synthetic-v1", "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(manifest.version, "matrix-ocr-gold-v1");
  assert.equal(manifest.classification, "synthetic-no-client-data");
  assert.equal(manifest.production_candidate, false);
  assert(Array.isArray(manifest.cases) && manifest.cases.length >= 3);
  const ids = new Set<string>();
  return manifest.cases.map((raw, index) => {
    assert(raw && typeof raw === "object" && !Array.isArray(raw));
    const value = raw as Record<string, unknown>;
    assert(typeof value.id === "string" && /^[a-z0-9-]+$/.test(value.id));
    assert(!ids.has(value.id), `duplicate case id: ${value.id}`);
    ids.add(value.id);
    return {
      id: value.id,
      lines: stringArray(value.lines, `cases[${index}].lines`),
      criticalFields: stringArray(
        value.critical_fields,
        `cases[${index}].critical_fields`,
      ),
      citationAnchors: stringArray(
        value.citation_anchors,
        `cases[${index}].citation_anchors`,
      ),
    };
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fixtureSvg(lines: string[]): Buffer {
  const text = lines
    .map(
      (line, index) =>
        `<text x="90" y="${150 + index * 145}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="64" fill="black">${escapeXml(line)}</text>`,
    )
    .join("");
  return Buffer.from(
    `<svg width="1500" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="1500" height="720" fill="white"/>${text}</svg>`,
  );
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "matrix-ocr-quality-"));
  const processor = await OnnxMatrixOcrProcessor.create({
    resourcesRoot: join(serviceRoot, "resources"),
    dpi: 160,
    maxPages: 4,
    intraOpThreads: 2,
  });
  try {
    const reports = [];
    const cases = await loadCases();
    for (const fixture of cases) {
      const sourcePath = join(root, `${fixture.id}.png`);
      await sharp(fixtureSvg(fixture.lines)).png().toFile(sourcePath);
      const result = await processor.process({
        sourcePath,
        mediaType: "image/png",
        language: "auto",
        enableTable: false,
        enableFormula: false,
        signal: new AbortController().signal,
        workDir: join(root, `${fixture.id}-work`),
      });
      const goldPages: OcrGoldPage[] = [
        {
          physical_page_number: 1,
          text: fixture.lines.join("\n"),
          critical_fields: fixture.criticalFields,
          citation_anchors: fixture.citationAnchors,
        },
      ];
      reports.push({
        id: fixture.id,
        report: evaluateOcrQuality({
          result,
          goldPages,
          policy: REGRESSION_POLICY,
        }),
      });
    }
    assert(
      reports.every(({ report }) => report.gate_passed),
      `synthetic OCR regression gate failed: ${JSON.stringify(
        reports.map(({ id, report }) => ({ id, failures: report.gate_failures })),
      )}`,
    );
    process.stdout.write(
      `${JSON.stringify({
        status: "passed",
        policy: "synthetic-regression-only",
        dataset_id: "synthetic-v1",
        production_candidate: false,
        model_version: processor.modelVersion,
        thresholds: REGRESSION_POLICY,
        cases: reports,
      })}\n`,
    );
  } finally {
    await processor.close();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Matrix OCR synthetic quality gate failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
