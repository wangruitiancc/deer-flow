import type {
  MatrixOcrBlock,
  MatrixOcrBlockStructure,
  MatrixOcrResponse,
} from "./contracts.js";

export interface OcrGoldBlock {
  reading_order: number;
  kind: MatrixOcrBlock["kind"];
  structure?: MatrixOcrBlockStructure;
}

export interface OcrGoldPage {
  physical_page_number: number;
  text: string;
  critical_fields?: string[];
  citation_anchors?: string[];
  blocks?: OcrGoldBlock[];
}

export interface OcrQualityPolicy {
  lowConfidenceThreshold: number;
  maxCharacterErrorRate: number;
  minCriticalFieldRecall: number;
  minCitationAnchorRecall: number;
  minMeanConfidence: number;
  maxLowConfidenceBlockRate: number;
  minTableStructureRecall: number;
  minFormulaStructureRecall: number;
}

export interface OcrQualityReport {
  pages_expected: number;
  pages_received: number;
  character_edits: number;
  expected_characters: number;
  character_error_rate: number;
  critical_fields_total: number;
  critical_fields_matched: number;
  critical_field_recall: number;
  citation_anchors_total: number;
  citation_anchors_matched: number;
  citation_anchor_recall: number;
  blocks_total: number;
  low_confidence_blocks: number;
  missing_confidence_blocks: number;
  low_confidence_block_rate: number;
  mean_confidence: number | null;
  confusion_counts: Record<string, number>;
  tables_total: number;
  tables_matched: number;
  table_structure_recall: number;
  formulas_total: number;
  formulas_matched: number;
  formula_structure_recall: number;
  review_required: boolean;
  review_reasons: string[];
  gate_passed: boolean;
  gate_failures: string[];
}

const CONFUSION_PAIRS = new Set([
  "0→O",
  "O→0",
  "1→I",
  "I→1",
  "1→l",
  "l→1",
  "2→Z",
  "Z→2",
  "5→S",
  "S→5",
  "8→B",
  "B→8",
]);

export function normalizeOcrText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleUpperCase("en-US");
}

function alignment(
  expected: string,
  actual: string,
): { edits: number; confusions: Record<string, number> } {
  const left = Array.from(expected);
  const right = Array.from(actual);
  const width = right.length + 1;
  const costs = new Uint32Array((left.length + 1) * width);
  for (let row = 0; row <= left.length; row += 1) costs[row * width] = row;
  for (let column = 0; column <= right.length; column += 1) costs[column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitution =
        costs[(row - 1) * width + column - 1]! +
        (left[row - 1] === right[column - 1] ? 0 : 1);
      const deletion = costs[(row - 1) * width + column]! + 1;
      const insertion = costs[row * width + column - 1]! + 1;
      costs[row * width + column] = Math.min(
        substitution,
        deletion,
        insertion,
      );
    }
  }

  const confusions: Record<string, number> = {};
  let row = left.length;
  let column = right.length;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0) {
      const same = left[row - 1] === right[column - 1];
      const diagonal =
        costs[(row - 1) * width + column - 1]! + (same ? 0 : 1);
      if (costs[row * width + column] === diagonal) {
        if (!same) {
          const key = `${left[row - 1]}→${right[column - 1]}`;
          if (CONFUSION_PAIRS.has(key)) confusions[key] = (confusions[key] ?? 0) + 1;
        }
        row -= 1;
        column -= 1;
        continue;
      }
    }
    if (
      row > 0 &&
      costs[row * width + column] === costs[(row - 1) * width + column]! + 1
    ) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return { edits: costs[left.length * width + right.length]!, confusions };
}

function ratio(matched: number, total: number): number {
  return total === 0 ? 1 : matched / total;
}

function structureSignature(structure: MatrixOcrBlockStructure): string {
  if (structure.type === "formula") {
    return `formula:${structure.latex.replace(/\s+/gu, "")}`;
  }
  return JSON.stringify({
    type: structure.type,
    rows: structure.rows,
    columns: structure.columns,
    cells: [...structure.cells]
      .sort(
        (left, right) =>
          left.row - right.row || left.column - right.column,
      )
      .map((cell) => ({
        row: cell.row,
        column: cell.column,
        row_span: cell.row_span,
        column_span: cell.column_span,
        text: normalizeOcrText(cell.text),
      })),
  });
}

export function evaluateOcrQuality(input: {
  result: MatrixOcrResponse;
  goldPages: OcrGoldPage[];
  policy: OcrQualityPolicy;
}): OcrQualityReport {
  const actualByPage = new Map(
    input.result.pages.map((page) => [page.physical_page_number, page]),
  );
  let characterEdits = 0;
  let expectedCharacters = 0;
  let criticalFieldsTotal = 0;
  let criticalFieldsMatched = 0;
  let citationAnchorsTotal = 0;
  let citationAnchorsMatched = 0;
  const confusionCounts: Record<string, number> = {};
  let tablesTotal = 0;
  let tablesMatched = 0;
  let formulasTotal = 0;
  let formulasMatched = 0;

  for (const gold of input.goldPages) {
    const expected = normalizeOcrText(gold.text);
    const actual = normalizeOcrText(
      actualByPage.get(gold.physical_page_number)?.text ?? "",
    );
    const compared = alignment(expected, actual);
    characterEdits += compared.edits;
    expectedCharacters += Array.from(expected).length;
    for (const [key, count] of Object.entries(compared.confusions)) {
      confusionCounts[key] = (confusionCounts[key] ?? 0) + count;
    }
    for (const field of gold.critical_fields ?? []) {
      criticalFieldsTotal += 1;
      if (actual.includes(normalizeOcrText(field))) criticalFieldsMatched += 1;
    }
    for (const anchor of gold.citation_anchors ?? []) {
      citationAnchorsTotal += 1;
      if (actual.includes(normalizeOcrText(anchor))) citationAnchorsMatched += 1;
    }
    const actualBlocks = actualByPage.get(gold.physical_page_number)?.blocks ?? [];
    const actualByOrder = new Map(
      actualBlocks.map((block) => [block.reading_order, block]),
    );
    for (const expectedBlock of gold.blocks ?? []) {
      if (!expectedBlock.structure) continue;
      const actualBlock = actualByOrder.get(expectedBlock.reading_order);
      const matched =
        actualBlock?.kind === expectedBlock.kind &&
        actualBlock.structure !== null &&
        structureSignature(actualBlock.structure) ===
          structureSignature(expectedBlock.structure);
      if (expectedBlock.structure.type === "table") {
        tablesTotal += 1;
        if (matched) tablesMatched += 1;
      } else {
        formulasTotal += 1;
        if (matched) formulasMatched += 1;
      }
    }
  }

  const blocks = input.result.pages.flatMap((page) => page.blocks);
  const confidences = blocks.flatMap((block) =>
    block.confidence === null ? [] : [block.confidence],
  );
  const lowConfidenceBlocks = confidences.filter(
    (confidence) => confidence < input.policy.lowConfidenceThreshold,
  ).length;
  const missingConfidenceBlocks = blocks.length - confidences.length;
  const meanConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : null;
  const characterErrorRate = characterEdits / Math.max(1, expectedCharacters);
  const criticalFieldRecall = ratio(criticalFieldsMatched, criticalFieldsTotal);
  const citationAnchorRecall = ratio(citationAnchorsMatched, citationAnchorsTotal);
  const lowConfidenceBlockRate = lowConfidenceBlocks / Math.max(1, blocks.length);
  const tableStructureRecall = ratio(tablesMatched, tablesTotal);
  const formulaStructureRecall = ratio(formulasMatched, formulasTotal);
  const pageMismatch = input.result.pages.length !== input.goldPages.length;
  const reviewReasons = [
    ...(pageMismatch ? ["page_count_mismatch"] : []),
    ...(missingConfidenceBlocks ? ["missing_block_confidence"] : []),
    ...(lowConfidenceBlocks ? ["low_confidence_block"] : []),
    ...(criticalFieldsMatched < criticalFieldsTotal
      ? ["critical_field_not_recognized"]
      : []),
    ...(citationAnchorsMatched < citationAnchorsTotal
      ? ["citation_anchor_not_recognized"]
      : []),
    ...(tablesMatched < tablesTotal ? ["table_structure_not_recognized"] : []),
    ...(formulasMatched < formulasTotal
      ? ["formula_structure_not_recognized"]
      : []),
  ];
  const gateFailures = [
    ...(pageMismatch ? ["page_count"] : []),
    ...(characterErrorRate > input.policy.maxCharacterErrorRate
      ? ["character_error_rate"]
      : []),
    ...(criticalFieldRecall < input.policy.minCriticalFieldRecall
      ? ["critical_field_recall"]
      : []),
    ...(citationAnchorRecall < input.policy.minCitationAnchorRecall
      ? ["citation_anchor_recall"]
      : []),
    ...(meanConfidence === null || meanConfidence < input.policy.minMeanConfidence
      ? ["mean_confidence"]
      : []),
    ...(lowConfidenceBlockRate > input.policy.maxLowConfidenceBlockRate
      ? ["low_confidence_block_rate"]
      : []),
    ...(missingConfidenceBlocks ? ["missing_block_confidence"] : []),
    ...(tableStructureRecall < input.policy.minTableStructureRecall
      ? ["table_structure_recall"]
      : []),
    ...(formulaStructureRecall < input.policy.minFormulaStructureRecall
      ? ["formula_structure_recall"]
      : []),
  ];

  return {
    pages_expected: input.goldPages.length,
    pages_received: input.result.pages.length,
    character_edits: characterEdits,
    expected_characters: expectedCharacters,
    character_error_rate: characterErrorRate,
    critical_fields_total: criticalFieldsTotal,
    critical_fields_matched: criticalFieldsMatched,
    critical_field_recall: criticalFieldRecall,
    citation_anchors_total: citationAnchorsTotal,
    citation_anchors_matched: citationAnchorsMatched,
    citation_anchor_recall: citationAnchorRecall,
    blocks_total: blocks.length,
    low_confidence_blocks: lowConfidenceBlocks,
    missing_confidence_blocks: missingConfidenceBlocks,
    low_confidence_block_rate: lowConfidenceBlockRate,
    mean_confidence: meanConfidence,
    confusion_counts: confusionCounts,
    tables_total: tablesTotal,
    tables_matched: tablesMatched,
    table_structure_recall: tableStructureRecall,
    formulas_total: formulasTotal,
    formulas_matched: formulasMatched,
    formula_structure_recall: formulaStructureRecall,
    review_required: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    gate_passed: gateFailures.length === 0,
    gate_failures: gateFailures,
  };
}
