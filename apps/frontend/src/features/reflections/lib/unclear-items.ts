const MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * The separate items of a "still unclear" answer: one per line, without list
 * markers. Repeats are dropped; a single paragraph stays one item for the
 * learner to reword.
 */
export function unclearItems(text: string): string[] {
  const items = text
    .split(/\r?\n/)
    .map((line) => line.replace(MARKER, "").trim())
    .filter(Boolean);
  return [...new Set(items)];
}
