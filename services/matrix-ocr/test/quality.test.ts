import assert from "node:assert/strict";
import test from "node:test";

import type { MatrixOcrResponse } from "../src/contracts.js";
import {
  evaluateOcrQuality,
  normalizeOcrText,
  type OcrQualityPolicy,
} from "../src/quality.js";

const POLICY: OcrQualityPolicy = {
  lowConfidenceThreshold: 0.8,
  maxCharacterErrorRate: 0.1,
  minCriticalFieldRecall: 1,
  minCitationAnchorRecall: 1,
  minMeanConfidence: 0.8,
  maxLowConfidenceBlockRate: 0.25,
  minTableStructureRecall: 1,
  minFormulaStructureRecall: 1,
};

function result(text: string, confidence: number | null): MatrixOcrResponse {
  return {
    version: "matrix-ocr-http-v1",
    model_version: "fixture",
    pages: [
      {
        physical_page_number: 1,
        scan_page_number: 1,
        printed_page_label: null,
        width_points: 100,
        height_points: 100,
        rotation_degrees: 0,
        text,
        blocks: [
          {
            block_index: 0,
            reading_order: 0,
            kind: "text",
            text,
            bbox: [0.1, 0.1, 0.9, 0.2],
            confidence,
            structure: null,
          },
        ],
      },
    ],
  };
}

test("normalization is Unicode-stable and ignores layout whitespace", () => {
  assert.equal(normalizeOcrText("Ａ b\n合同  01"), "AB合同01");
});

test("quality gate passes an exact high-confidence result", () => {
  const report = evaluateOcrQuality({
    result: result("合同编号 2026\n金额 128000 元", 0.95),
    goldPages: [
      {
        physical_page_number: 1,
        text: "合同编号 2026\n金额 128000 元",
        critical_fields: ["2026", "128000"],
        citation_anchors: ["合同编号 2026"],
      },
    ],
    policy: POLICY,
  });
  assert.equal(report.gate_passed, true);
  assert.equal(report.review_required, false);
  assert.equal(report.character_error_rate, 0);
});

test("quality report exposes 0/O confusion and requires review", () => {
  const report = evaluateOcrQuality({
    result: result("付款期限 3O 日", 0.72),
    goldPages: [
      {
        physical_page_number: 1,
        text: "付款期限 30 日",
        critical_fields: ["30 日"],
        citation_anchors: ["付款期限 30 日"],
      },
    ],
    policy: POLICY,
  });
  assert.equal(report.confusion_counts["0→O"], 1);
  assert.equal(report.review_required, true);
  assert.deepEqual(report.gate_failures.sort(), [
    "character_error_rate",
    "citation_anchor_recall",
    "critical_field_recall",
    "low_confidence_block_rate",
    "mean_confidence",
  ]);
});

test("missing pages and confidence fail closed", () => {
  const response = result("第一页", null);
  const report = evaluateOcrQuality({
    result: response,
    goldPages: [
      { physical_page_number: 1, text: "第一页" },
      { physical_page_number: 2, text: "第二页" },
    ],
    policy: POLICY,
  });
  assert.equal(report.pages_received, 1);
  assert.equal(report.missing_confidence_blocks, 1);
  assert.equal(report.gate_passed, false);
  assert(report.gate_failures.includes("page_count"));
  assert(report.gate_failures.includes("missing_block_confidence"));
});

test("table and formula structures are scored independently from plain text", () => {
  const response = result("金额 100 元\nE=mc^2", 0.95);
  response.pages[0]!.blocks = [
    {
      block_index: 0,
      reading_order: 0,
      kind: "table",
      text: "项目 金额\n服务 100 元",
      bbox: [0.1, 0.1, 0.9, 0.4],
      confidence: 0.95,
      structure: {
        type: "table",
        rows: 2,
        columns: 2,
        cells: [
          { row: 0, column: 0, row_span: 1, column_span: 1, text: "项目" },
          { row: 0, column: 1, row_span: 1, column_span: 1, text: "金额" },
          { row: 1, column: 0, row_span: 1, column_span: 1, text: "服务" },
          { row: 1, column: 1, row_span: 1, column_span: 1, text: "100 元" },
        ],
      },
    },
    {
      block_index: 1,
      reading_order: 1,
      kind: "formula",
      text: "E=mc²",
      bbox: [0.1, 0.5, 0.5, 0.6],
      confidence: 0.95,
      structure: { type: "formula", latex: "E = mc^2" },
    },
  ];
  response.pages[0]!.text = response.pages[0]!.blocks
    .map((block) => block.text)
    .join("\n");
  const report = evaluateOcrQuality({
    result: response,
    goldPages: [
      {
        physical_page_number: 1,
        text: response.pages[0]!.text,
        blocks: response.pages[0]!.blocks.map((block) => ({
          reading_order: block.reading_order,
          kind: block.kind,
          structure: block.structure!,
        })),
      },
    ],
    policy: POLICY,
  });
  assert.equal(report.table_structure_recall, 1);
  assert.equal(report.formula_structure_recall, 1);
  assert.equal(report.gate_passed, true);
});

test("missing requested structure fails closed even when extracted text matches", () => {
  const response = result("项目 金额 服务 100 元", 0.95);
  const report = evaluateOcrQuality({
    result: response,
    goldPages: [
      {
        physical_page_number: 1,
        text: response.pages[0]!.text,
        blocks: [
          {
            reading_order: 0,
            kind: "table",
            structure: {
              type: "table",
              rows: 1,
              columns: 2,
              cells: [
                { row: 0, column: 0, row_span: 1, column_span: 1, text: "项目" },
                { row: 0, column: 1, row_span: 1, column_span: 1, text: "金额" },
              ],
            },
          },
        ],
      },
    ],
    policy: POLICY,
  });
  assert.equal(report.table_structure_recall, 0);
  assert(report.review_reasons.includes("table_structure_not_recognized"));
  assert(report.gate_failures.includes("table_structure_recall"));
});
