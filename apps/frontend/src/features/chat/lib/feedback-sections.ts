import type { FeedbackSection, FeedbackSectionId } from "@/lib/client";

export type ParsedFeedbackSection = {
  id: FeedbackSectionId;
  heading: string;
  body: string;
};

export type ParsedFeedback = {
  /** Text before the first heading; normally empty. */
  preamble: string;
  sections: ParsedFeedbackSection[];
};

export const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Markdown heading line (any level, optionally bold) with this text. */
export const headingPattern = (heading: string) =>
  new RegExp(
    `^[ \\t]*#{1,6}[ \\t]*(?:\\*\\*)?${escapeRegExp(heading)}(?:\\*\\*)?[ \\t]*:?[ \\t]*$`,
    "im",
  );

/**
 * Splits a structured feedback reply into the mode's fixed sections.
 *
 * Returns null when the reply is not structured feedback: the first heading is
 * missing (for example the agent is asking the learner to explain) or the
 * headings are out of order. Later sections may be missing while a reply is
 * still streaming; they are omitted.
 */
export function parseFeedback(
  content: string,
  sections: readonly FeedbackSection[],
): ParsedFeedback | null {
  if (!sections.length) return null;
  const found: { section: FeedbackSection; start: number; end: number }[] = [];
  for (const section of sections) {
    const match = headingPattern(section.heading).exec(content);
    if (!match) continue;
    found.push({
      section,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  if (found[0]?.section.id !== sections[0].id) return null;
  if (
    found.some((item, index) => index > 0 && item.start < found[index - 1].end)
  )
    return null;
  return {
    preamble: content.slice(0, found[0].start).trim(),
    sections: found.map((item, index) => ({
      id: item.section.id,
      heading: item.section.heading,
      body: content.slice(item.end, found[index + 1]?.start).trim(),
    })),
  };
}
