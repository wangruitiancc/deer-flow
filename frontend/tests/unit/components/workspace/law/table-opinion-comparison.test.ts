import { describe, expect, it } from "@rstest/core";

import { compareTableOpinion } from "@/components/workspace/law/table-opinion-comparison";
import type { OcrBlockStructure } from "@/core/law/types";

const source: OcrBlockStructure = {
  type: "table", rows: 2, columns: 2, cells: [
    { row: 0, column: 0, row_span: 1, column_span: 2, text: "本金" },
    { row: 1, column: 0, row_span: 1, column_span: 1, text: "12000" },
    { row: 1, column: 1, row_span: 1, column_span: 1, text: "8%" },
  ],
};

describe("table opinion comparison", () => {
  it("marks exact cell text differences only after the merged grid matches", () => {
    const opinion = structuredClone(source);
    if (opinion.type !== "table") throw new Error("table fixture");
    opinion.cells[1]!.text = "120000";
    const result = compareTableOpinion(source, opinion);
    expect(result.kind).toBe("text_mismatch");
    if (result.kind === "text_mismatch") expect([...result.changedCells]).toEqual(["1:0"]);
  });

  it("does not guess cell correspondence when a span differs", () => {
    const opinion = structuredClone(source);
    if (opinion.type !== "table") throw new Error("table fixture");
    opinion.cells[0]!.column_span = 1;
    expect(compareTableOpinion(source, opinion)).toEqual({ kind: "structure_mismatch" });
  });

  it("keeps missing original structure distinct from agreement", () => {
    if (source.type !== "table") throw new Error("table fixture");
    expect(compareTableOpinion(null, source)).toEqual({ kind: "unavailable" });
    expect(compareTableOpinion(source, source)).toEqual({ kind: "same" });
  });
});
