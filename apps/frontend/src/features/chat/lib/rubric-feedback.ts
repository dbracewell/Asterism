import type { RubricFeedbackFormat } from "@/lib/client";
import { escapeRegExp, headingPattern } from "./feedback-sections";

/** The labels a reply is parsed against: the turn's pinned rubric. */
export type RubricLabels = {
  /** Level names from the highest to the lowest. */
  levels: readonly string[];
  /** Criterion names in rubric order. */
  criteria: readonly string[];
};

export type ParsedCriterion = {
  criterion: string;
  /** The estimated level as written, or null when the line is missing. */
  level: string | null;
  /** Position in `levels` (0 is highest), or null for an unknown level. */
  levelIndex: number | null;
  /** The section text without the level line. */
  body: string;
};

export type ParsedRubricFeedback = {
  /** Text before the first heading; normally empty. */
  preamble: string;
  criteria: ParsedCriterion[];
  /** The closing section, or null while streaming or if the model left it out. */
  overall: string | null;
};

const fold = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/** A `<label>: <level>` line, optionally bold; captures the level. */
const levelPattern = (label: string) =>
  new RegExp(
    `^[ \\t]*(?:\\*\\*)?${escapeRegExp(label)}(?::\\*\\*|\\*\\*:|:)[ \\t]*(?:\\*\\*)?(.+?)(?:\\*\\*)?[ \\t]*$`,
    "im",
  );

/**
 * Splits a Draft feedback reply into one section per rubric criterion and the
 * overall section (US-57.1).
 *
 * Returns null when the reply is not rubric feedback: the first criterion's
 * heading is missing (for example the agent is asking for a rubric or a
 * draft, or giving an example rewrite) or the headings are out of order.
 * Later sections may be missing while a reply is still streaming.
 */
export function parseRubricFeedback(
  content: string,
  rubric: RubricLabels,
  format: RubricFeedbackFormat,
): ParsedRubricFeedback | null {
  if (!rubric.criteria.length) return null;
  const headings = [...rubric.criteria, format.overall_heading];
  const found: { index: number; start: number; end: number }[] = [];
  headings.forEach((heading, index) => {
    const match = headingPattern(heading).exec(content);
    if (match)
      found.push({
        index,
        start: match.index,
        end: match.index + match[0].length,
      });
  });
  if (found[0]?.index !== 0) return null;
  if (
    found.some((item, index) => index > 0 && item.start < found[index - 1].end)
  )
    return null;
  const levels = rubric.levels.map(fold);
  const levelLine = levelPattern(format.level_label);
  const sections = found.map((item, index) => ({
    index: item.index,
    text: content.slice(item.end, found[index + 1]?.start).trim(),
  }));
  const overallIndex = rubric.criteria.length;
  return {
    preamble: content.slice(0, found[0].start).trim(),
    criteria: sections
      .filter((section) => section.index < overallIndex)
      .map((section) => {
        const match = levelLine.exec(section.text);
        const level = match ? match[1].replace(/^[*\s]+|[*.\s]+$/g, "") : null;
        const position = level === null ? -1 : levels.indexOf(fold(level));
        return {
          criterion: rubric.criteria[section.index],
          level,
          levelIndex: position < 0 ? null : position,
          body: match
            ? (
                section.text.slice(0, match.index) +
                section.text.slice(match.index + match[0].length)
              ).trim()
            : section.text,
        };
      }),
    overall:
      sections.find((section) => section.index === overallIndex)?.text ?? null,
  };
}
