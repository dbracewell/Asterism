/**
 * Reflow a stored passage for reading (US-90.4): extracted text keeps the
 * source's hard line wraps, which read as a stack of short lines. Wrapped lines
 * are joined into paragraphs; structure (headings, list items, quotes, table
 * rows) keeps its own lines. Text with a fenced code block is returned as is.
 *
 * Two shapes are common. Plain text and Markdown separate paragraphs with a
 * blank line and wrap with a single newline. PDF extraction often puts a blank
 * line after every wrapped line; there a line joins the next unless it ends a
 * sentence or is short like a heading.
 */
export type PassageText =
  | { kind: "paragraphs"; paragraphs: string[] }
  | { kind: "preformatted"; text: string };

const STRUCTURE = /^(#{1,6}\s|[-*+•]\s|\d+[.)]\s|>\s?|\|)/;
const HEADING = /^#{1,6}\s/;
const SENTENCE_END = /[.!?:;]["'”’)\]]*$/;
/** A line this much shorter than the longest is a heading or a paragraph's end. */
const SHORT = 0.6;

type Line = { text: string; blankBefore: boolean };

function joinLines(left: string, right: string): string {
  return /[A-Za-z]-$/.test(left) && /^[a-z]/.test(right)
    ? left + right
    : `${left} ${right}`;
}

export function reflowPassage(raw: string): PassageText {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.includes("```")) return { kind: "preformatted", text };

  const lines: Line[] = [];
  let blank = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      blank = true;
      continue;
    }
    lines.push({ text: trimmed, blankBefore: blank && lines.length > 0 });
    blank = false;
  }
  if (lines.length === 0) return { kind: "paragraphs", paragraphs: [] };

  // Every line set apart by a blank line: the blanks are wrapping, not paragraphs.
  const spaced = lines.slice(1).every((line) => line.blankBefore);
  const longest = Math.max(...lines.map((line) => line.text.length));

  const paragraphs = [lines[0].text];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1].text;
    const { text: next, blankBefore } = lines[index];
    const structural =
      STRUCTURE.test(next) ||
      HEADING.test(previous) ||
      previous.startsWith("|");
    const join =
      !structural &&
      (spaced
        ? !SENTENCE_END.test(previous) &&
          (/^[a-z]/.test(next) || previous.length >= longest * SHORT)
        : !blankBefore);
    if (join)
      paragraphs[paragraphs.length - 1] = joinLines(
        paragraphs[paragraphs.length - 1],
        next,
      );
    else paragraphs.push(next);
  }
  return { kind: "paragraphs", paragraphs };
}
