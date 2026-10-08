import { describe, expect, it } from "@rstest/core";

import { draftTableCandidates, sourceTableBody } from "@/components/workspace/law/ocr-cross-page-table-selection";

describe("OCR cross-page table selection", () => {
  it("finds multiple authored tables with Unicode code-point offsets", () => {
    const first = "| 项目 | 金额 |\n| --- | --- |\n| 服务费 | 12.00 |";
    const second = "| 项目 | 金额 |\n| --- | --- |\n| 利息 | 1.00 |";
    const markdown = `😀前文\n\n${first}\n\n过渡\n\n${second}\n尾注`;
    const found = draftTableCandidates(markdown);
    expect(found.map((table) => table.text)).toEqual([first, second]);
    for (const table of found) {
      expect(Array.from(markdown).slice(table.start_character, table.end_character).join(""))
        .toBe(table.text);
    }
  });

  it("does not offer malformed or ambiguous cell structures", () => {
    expect(draftTableCandidates("| 项目 | 金额 |\n| --- | --- |\n| 服务费 | 12\\|00 |"))
      .toEqual([]);
    expect(draftTableCandidates("| 项目 | 金额 |\n| --- | --- |\n| 服务费 |"))
      .toEqual([]);
  });

  it("finds a merged-cell HTML table with Unicode code-point offsets", () => {
    const html = '<table>\n<tr>\n<td colspan="2">付款表</td>\n</tr>\n' +
      '<tr>\n<td>项目</td>\n<td>金额</td>\n</tr>\n' +
      '<tr>\n<td rowspan="2">服务费</td>\n<td>12.00</td>\n</tr>\n' +
      '<tr>\n<td>1.00</td>\n</tr>\n</table>';
    const draft = `😀前文\n${html}\n后文`;
    const [candidate] = draftTableCandidates(draft);
    expect(candidate?.format).toBe("html");
    expect(candidate?.row_count).toBe(4);
    expect(Array.from(draft).slice(candidate!.start_character, candidate!.end_character).join(""))
      .toBe(html);
    expect(sourceTableBody(`${html}\n合成脚注`)).toBe(html);
    expect(sourceTableBody(`${html}\n<table>第二张表</table>`)).not.toBe(html);
  });
});
