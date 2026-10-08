export function pairedScrollTop(
  source: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  target: Pick<HTMLElement, "scrollHeight" | "clientHeight">,
): number | null {
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;
  if (sourceRange <= 0 || targetRange <= 0) return null;
  const progress = Math.max(0, Math.min(1, source.scrollTop / sourceRange));
  return progress * targetRange;
}
