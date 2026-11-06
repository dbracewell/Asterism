export const MAX_TAGS = 8;
export const MAX_TAG_CHARS = 40;

/**
 * Comma-separated topic tags as the server stores them: trimmed, inner
 * whitespace collapsed, case-insensitive repeats dropped (US-58.3).
 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of text.split(",")) {
    const tag = part.replace(/\s+/g, " ").trim();
    if (!tag || seen.has(tag.toLocaleLowerCase())) continue;
    seen.add(tag.toLocaleLowerCase());
    tags.push(tag);
  }
  return tags;
}

export const formatTags = (tags: readonly string[]) => tags.join(", ");

/** A problem with the typed tags, or null when the server will accept them. */
export function tagProblem(tags: readonly string[]): string | null {
  if (tags.length > MAX_TAGS) return `Use at most ${MAX_TAGS} topics.`;
  const long = tags.find((tag) => tag.length > MAX_TAG_CHARS);
  return long
    ? `Keep each topic under ${MAX_TAG_CHARS} characters ("${long.slice(0, 20)}…").`
    : null;
}
