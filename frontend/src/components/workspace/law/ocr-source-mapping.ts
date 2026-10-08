export type OcrSourceAnchor = { id: string; text: string };

export type OcrSourceSpan = { id: string; start: number; end: number };

export function uniqueSourceSpans(
  draft: string,
  anchors: readonly OcrSourceAnchor[],
): OcrSourceSpan[] {
  return anchors.flatMap((anchor) => {
    const text = anchor.text.trim();
    if (!text || anchors.filter((item) => item.text.trim() === text).length !== 1) {
      return [];
    }
    const start = draft.indexOf(text);
    if (start < 0 || draft.includes(text, start + text.length)) return [];
    return [{ id: anchor.id, start, end: start + text.length }];
  });
}

export function sourceSpanAtSelection(
  spans: readonly OcrSourceSpan[],
  selectionStart: number,
  selectionEnd: number,
): OcrSourceSpan | null {
  const matches = spans.filter(
    (span) => selectionStart >= span.start && selectionEnd <= span.end,
  );
  return matches.length === 1 ? matches[0]! : null;
}
