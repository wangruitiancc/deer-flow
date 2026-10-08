import type { OcrBlockStructure, OcrTableCell } from "@/core/law/types";

export type TableOpinionComparison =
  | { kind: "unavailable" }
  | { kind: "structure_mismatch" }
  | { kind: "same" }
  | { kind: "text_mismatch"; changedCells: ReadonlySet<string> };

type TableStructure = Extract<OcrBlockStructure, { type: "table" }>;

function cellsByPosition(cells: OcrTableCell[]): Map<string, OcrTableCell> | null {
  const result = new Map<string, OcrTableCell>();
  for (const cell of cells) {
    const key = `${cell.row}:${cell.column}`;
    if (result.has(key)) return null;
    result.set(key, cell);
  }
  return result;
}

export function compareTableOpinion(
  original: OcrBlockStructure | null,
  opinion: TableStructure,
): TableOpinionComparison {
  if (original?.type !== "table") return { kind: "unavailable" };
  if (original.rows !== opinion.rows || original.columns !== opinion.columns
    || original.cells.length !== opinion.cells.length) return { kind: "structure_mismatch" };
  const sourceCells = cellsByPosition(original.cells);
  const opinionCells = cellsByPosition(opinion.cells);
  if (!sourceCells) return { kind: "structure_mismatch" };
  if (!opinionCells) return { kind: "structure_mismatch" };
  if (sourceCells.size !== opinionCells.size) {
    return { kind: "structure_mismatch" };
  }
  const changedCells = new Set<string>();
  for (const [position, candidate] of opinionCells) {
    const source = sourceCells.get(position);
    if (!source) return { kind: "structure_mismatch" };
    if (source.row_span !== candidate.row_span || source.column_span !== candidate.column_span) {
      return { kind: "structure_mismatch" };
    }
    if (source.text !== candidate.text) changedCells.add(position);
  }
  return changedCells.size ? { kind: "text_mismatch", changedCells } : { kind: "same" };
}
