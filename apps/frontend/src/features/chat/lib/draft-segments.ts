/** A highlighted range of a draft document, in UTF-16 offsets (US-57.2). */
export type DraftSpan = { id: string; start: number; end: number };

export type DraftSegment = {
  text: string;
  start: number;
  /** Comment IDs whose spans cover this segment, in span order. */
  ids: string[];
};

/**
 * Splits text at every span boundary so overlapping comments can share
 * highlighted segments. Spans outside the text are clamped; empty spans are
 * ignored.
 */
export function draftSegments(
  text: string,
  spans: readonly DraftSpan[],
): DraftSegment[] {
  const valid = spans
    .map((span) => ({
      ...span,
      start: Math.max(0, Math.min(span.start, text.length)),
      end: Math.max(0, Math.min(span.end, text.length)),
    }))
    .filter((span) => span.end > span.start);
  const cuts = [
    ...new Set([
      0,
      text.length,
      ...valid.flatMap((span) => [span.start, span.end]),
    ]),
  ].sort((a, b) => a - b);
  const segments: DraftSegment[] = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const start = cuts[index];
    const end = cuts[index + 1];
    if (end <= start) continue;
    segments.push({
      text: text.slice(start, end),
      start,
      ids: valid
        .filter((span) => span.start <= start && span.end >= end)
        .map((span) => span.id),
    });
  }
  return segments;
}
