export interface PublishedTableCell {
  text: string;
  rowSpan: number;
  colSpan: number;
}

export interface PublishedTableRow {
  cells: PublishedTableCell[];
}

/** Parse a published table into text nodes; never insert authored HTML into the DOM. */
export function parsePublishedHtmlTable(source: string): PublishedTableRow[] | null {
  if (!source.startsWith("<table>\n") || !source.endsWith("\n</table>")) return null;
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const table = parsed.body.firstElementChild;
  if (parsed.body.children.length !== 1 || table?.tagName !== "TABLE") return null;
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length < 2 || rows.length > 500) return null;
  const result: PublishedTableRow[] = [];
  for (const row of rows) {
    if (!row.children.length || Array.from(row.children).some((cell) => cell.tagName !== "TD")) {
      return null;
    }
    const cells: PublishedTableCell[] = [];
    for (const element of Array.from(row.children)) {
      if (element.children.length || Array.from(element.attributes).some(
        (attribute) => !["rowspan", "colspan"].includes(attribute.name))) return null;
      const rowSpan = Number(element.getAttribute("rowspan") ?? 1);
      const colSpan = Number(element.getAttribute("colspan") ?? 1);
      if (!Number.isInteger(rowSpan) || !Number.isInteger(colSpan) ||
          rowSpan < 1 || colSpan < 1 || rowSpan > 500 || colSpan > 500) return null;
      cells.push({ text: element.textContent?.trim() ?? "", rowSpan, colSpan });
    }
    result.push({ cells });
  }
  return result;
}
