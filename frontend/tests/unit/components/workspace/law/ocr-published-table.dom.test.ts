import { describe, expect, it } from "@rstest/core";

import { parsePublishedHtmlTable } from "@/components/workspace/law/ocr-published-table";

describe("published OCR HTML table display", () => {
  it("extracts text and cell spans without rendering authored markup", () => {
    const rows = parsePublishedHtmlTable(
      '<table>\n<tr>\n<td colspan="2">付款 &amp; 核算</td>\n</tr>\n' +
      '<tr>\n<td rowspan="2">服务费</td>\n<td>12.00元</td>\n</tr>\n' +
      '<tr>\n<td>1.00元</td>\n</tr>\n</table>',
    );
    expect(rows).toEqual([
      { cells: [{ text: "付款 & 核算", rowSpan: 1, colSpan: 2 }] },
      { cells: [{ text: "服务费", rowSpan: 2, colSpan: 1 },
        { text: "12.00元", rowSpan: 1, colSpan: 1 }] },
      { cells: [{ text: "1.00元", rowSpan: 1, colSpan: 1 }] },
    ]);
  });

  it("rejects executable or unsupported nested markup", () => {
    expect(parsePublishedHtmlTable('<table>\n<tr><td onclick="bad()">甲</td></tr>\n</table>'))
      .toBeNull();
    expect(parsePublishedHtmlTable('<table>\n<tr><td><script>bad()</script>甲</td></tr>\n</table>'))
      .toBeNull();
  });
});
