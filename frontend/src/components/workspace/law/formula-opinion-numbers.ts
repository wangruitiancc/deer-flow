/** A narrow comparison cue, never a formula correctness decision. */
export function formulaNumberDisagreement(
  sourceOcr: string,
  privateOpinion: string,
): boolean | null {
  const tokens = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1")
      .match(/\d+(?:\.\d+)?/g) ?? [];
  const source = tokens(sourceOcr);
  const opinion = tokens(privateOpinion);
  if (source.length === 0 || opinion.length === 0) return null;
  return source.length !== opinion.length || source.some((value, index) => value !== opinion[index]);
}

/** Compare only recognizable math signs; matching signs do not establish formula correctness. */
export function formulaOperatorDisagreement(
  sourceOcr: string,
  privateOpinion: string,
): boolean | null {
  const operators = (value: string) => {
    const normalized = value.normalize("NFKC")
      .replace(/\\(?:times|cdot)/g, "*")
      .replace(/\\(?:div|d?frac)/g, "/")
      .replace(/\\pm/g, "±")
      .replace(/\\leq?(?![a-zA-Z])/g, "≤")
      .replace(/\\geq?(?![a-zA-Z])/g, "≥")
      .replace(/\\approx/g, "≈")
      .replace(/\\neq/g, "≠")
      .replace(/\\sqrt/g, "√")
      .replace(/\\[()[\]]/g, "")
      .replace(/[×·⋅]/g, "*")
      .replace(/÷/g, "/")
      .replace(/[−–—]/g, "-");
    return normalized.match(/[+\-*/=<>≤≥≈≠±^()%√]/g) ?? [];
  };
  const source = operators(sourceOcr);
  const opinion = operators(privateOpinion);
  if (source.length === 0 && opinion.length === 0) return null;
  return source.length !== opinion.length || source.some((value, index) => value !== opinion[index]);
}
