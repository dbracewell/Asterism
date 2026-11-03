"""Parsing Draft feedback replies (US-57.1, US-57.2).

A reply has one section per rubric criterion, in rubric order, then an overall
section. Each criterion section starts with a ``<level_label>: <level>`` line,
then pairs of a quoted passage (``>`` lines) and a note about it, and may end
with a ``Next step:`` line. Parsing is lenient about heading level, bold and
trailing colons, and returns None for replies that are not rubric feedback.
The UI mirrors these rules in ``features/chat/lib/rubric-feedback.ts``.
"""

import re
from dataclasses import dataclass

NEXT_STEP_LABEL = "Next step"


def heading_pattern(heading: str) -> re.Pattern[str]:
    """A Markdown heading line (any level, optionally bold) with this text."""
    return re.compile(rf"(?im)^\s*#{{1,6}}\s*(?:\*\*)?{re.escape(heading)}(?:\*\*)?\s*:?\s*$")


def level_pattern(label: str) -> re.Pattern[str]:
    """A ``<label>: <level>`` line, optionally bold; captures the level."""
    return re.compile(rf"(?im)^\s*(?:\*\*)?{re.escape(label)}(?::\*\*|\*\*:|:)\s*(?:\*\*)?(.+?)(?:\*\*)?\s*$")


_NEXT_STEP = re.compile(rf"(?i)^\s*(?:\*\*)?{re.escape(NEXT_STEP_LABEL)}(?::\*\*|\*\*:|:)")
_QUOTE_LINE = re.compile(r"^\s*>\s?(.*)$")
_QUOTE_MARKS = "\"'“”‘’«»"


def fold(text: str) -> str:
    return " ".join(text.split()).casefold()


@dataclass(frozen=True)
class QuotedNote:
    quote: str
    note: str


@dataclass(frozen=True)
class CriterionSection:
    criterion: str
    # The level as written, or None when the line is missing.
    level: str | None
    # Position in the rubric's levels (0 is highest), or None if unknown.
    level_index: int | None
    notes: tuple[QuotedNote, ...]
    text: str


@dataclass(frozen=True)
class RubricReply:
    criteria: tuple[CriterionSection, ...]
    overall: str | None


def _clean_quote(lines: list[str]) -> str:
    text = " ".join(line.strip() for line in lines).strip()
    text = re.sub(r"^(?:\*\*|\*|_)+|(?:\*\*|\*|_)+$", "", text).strip()
    if len(text) >= 2 and text[0] in _QUOTE_MARKS and text[-1] in _QUOTE_MARKS:
        text = text[1:-1].strip()
    return text


def quoted_notes(section: str) -> tuple[QuotedNote, ...]:
    """Each quoted passage with the note that follows it, up to the next quote or ``Next step:``."""
    pairs: list[QuotedNote] = []
    quote: list[str] = []
    note: list[str] = []
    current: str | None = None

    def flush() -> None:
        nonlocal current
        if current is not None and current:
            pairs.append(QuotedNote(quote=current, note=" ".join(" ".join(note).split())))
        current = None
        note.clear()

    stopped = False
    for line in section.splitlines():
        match = _QUOTE_LINE.match(line)
        if match:
            if not quote:
                flush()
                stopped = False
            quote.append(match.group(1))
            continue
        if quote:
            current = _clean_quote(quote)
            quote.clear()
        if _NEXT_STEP.match(line):
            stopped = True
            flush()
            continue
        if current is not None and not stopped:
            note.append(line)
    if quote:
        current = _clean_quote(quote)
    flush()
    return tuple(pairs)


def parse_rubric_reply(
    content: str, *, levels: tuple[str, ...], criteria: tuple[str, ...], level_label: str, overall_heading: str
) -> RubricReply | None:
    """Split a reply into criterion sections; None unless the first criterion leads, in order."""
    if not criteria:
        return None
    headings = [*criteria, overall_heading]
    found = [
        (index, match.start(), match.end())
        for index, heading in enumerate(headings)
        if (match := heading_pattern(heading).search(content))
    ]
    if not found or found[0][0] != 0:
        return None
    if any(start < found[position - 1][2] for position, (_, start, _) in enumerate(found) if position):
        return None
    folded = [fold(level) for level in levels]
    line = level_pattern(level_label)
    sections: list[CriterionSection] = []
    overall: str | None = None
    for position, (index, _, end) in enumerate(found):
        stop = found[position + 1][1] if position + 1 < len(found) else len(content)
        text = content[end:stop].strip()
        if index == len(criteria):
            overall = text
            continue
        match = line.search(text)
        level = match.group(1).strip(" *.") if match else None
        level_index = folded.index(fold(level)) if level is not None and fold(level) in folded else None
        body = (text[: match.start()] + text[match.end() :]).strip() if match else text
        sections.append(
            CriterionSection(
                criterion=criteria[index],
                level=level,
                level_index=level_index,
                notes=quoted_notes(body),
                text=body,
            )
        )
    return RubricReply(criteria=tuple(sections), overall=overall)
