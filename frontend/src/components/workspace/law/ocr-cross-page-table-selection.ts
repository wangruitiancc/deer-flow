/** Locate fixed draft tables without changing their text or character offsets. */

export interface DraftTableCandidate {
  text: string;
  start_character: number;
  end_character: number;
  format: "markdown" | "html";
  row_count: number;
}

export function sourceTableBody(value: string): string {
  if (!value.startsWith("<table>\n")) return value;
  const end = value.indexOf("\n</table>");
  if (end < 0 || value.includes("<table>", end + "\n</table>".length)) return value;
  return value.slice(0, end + "\n</table>".length);
}

function cells(line: string): string[] | null {
  if (!line.startsWith("|") || !line.endsWith("|") || line.includes("\\|")) {
    return null;
  }
  return line.slice(1, -1).split("|").map((cell) => cell.trim());
}

function validTable(lines: string[]): boolean {
  if (lines.length < 3) return false;
  const rows = lines.map(cells);
  const width = rows[0]?.length ?? 0;
  if (width < 2 || rows.some((row) => row?.length !== width || row.some((cell) => !cell))) {
    return false;
  }
  if (!rows[1]?.every((cell) => /^:?-{3,}:?$/.test(cell))) return false;
  return !rows.slice(2).some((row) => row?.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

export function draftTableCandidates(markdown: string): DraftTableCandidate[] {
  const lines = markdown.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const found: DraftTableCandidate[] = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index]?.startsWith("|")) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && lines[end]?.startsWith("|")) end += 1;
    const tableLines = lines.slice(index, end);
    if (validTable(tableLines)) {
      const startOffset = starts[index]!;
      const endOffset = starts[end - 1]! + lines[end - 1]!.length;
      found.push({
        text: markdown.slice(startOffset, endOffset),
        start_character: Array.from(markdown.slice(0, startOffset)).length,
        end_character: Array.from(markdown.slice(0, endOffset)).length,
        format: "markdown",
        row_count: tableLines.length - 1,
      });
    }
    index = end;
  }
  for (const match of markdown.matchAll(/<table>\n[\s\S]*?\n<\/table>/g)) {
    const text = match[0];
    const rowCount = [...text.matchAll(/<tr>/g)].length;
    if (rowCount < 2 || rowCount > 500 || !text.includes("<td")) continue;
    const start = match.index;
    const end = start + text.length;
    const startCharacter = Array.from(markdown.slice(0, start)).length;
    const endCharacter = Array.from(markdown.slice(0, end)).length;
    if (found.some((candidate) =>
      startCharacter < candidate.end_character && candidate.start_character < endCharacter)) continue;
    found.push({
      text,
      start_character: startCharacter,
      end_character: endCharacter,
      format: "html",
      row_count: rowCount,
    });
  }
  found.sort((left, right) => left.start_character - right.start_character);
  return found;
}
