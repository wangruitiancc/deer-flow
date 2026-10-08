import { describe, expect, it } from "@rstest/core";

import {
  sourceSpanAtSelection,
  uniqueSourceSpans,
} from "@/components/workspace/law/ocr-source-mapping";

describe("OCR source-mode mapping", () => {
  it("finds an unchanged merged table and formula by exact unique text", () => {
    const table = '<table><tr><td rowspan="2">金额</td></tr></table>';
    const formula = "总计 = 12 + 8 = 20 元";
    const draft = `标题\n${table}\n${formula}`;
    const spans = uniqueSourceSpans(draft, [
      { id: "table", text: table },
      { id: "formula", text: formula },
    ]);
    expect(spans).toEqual([
      { id: "table", start: 3, end: 3 + table.length },
      { id: "formula", start: 4 + table.length, end: draft.length },
    ]);
    expect(sourceSpanAtSelection(spans, draft.indexOf("金额"), draft.indexOf("金额"))).toEqual(spans[0]);
  });

  it("refuses changed or duplicated content and overlapping anchors", () => {
    expect(uniqueSourceSpans("已修改金额", [{ id: "old", text: "原金额" }])).toEqual([]);
    expect(uniqueSourceSpans("金额\n金额", [{ id: "one", text: "金额" }])).toEqual([]);
    expect(uniqueSourceSpans("金额", [
      { id: "one", text: "金额" }, { id: "two", text: "金额" },
    ])).toEqual([]);
    expect(sourceSpanAtSelection([
      { id: "outer", start: 0, end: 10 },
      { id: "inner", start: 2, end: 5 },
    ], 3, 3)).toBeNull();
  });
});
