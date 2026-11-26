"""Does a model answer with diagrams that draw? (EPIC-108, US-108.2)

Fixed prompts and a scorer for `scripts/evaluate_diagrams.py`, which asks a
live model each prompt under the main agent's runtime prompt, draws every
mermaid block with the export renderer (the app's preparation, configuration
and sanitizer) and reports the results. It measures the diagram guidance; it
never gates CI.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from asterism.domains.canvas.exports import mermaid_sources

if TYPE_CHECKING:
    from asterism.domains.canvas.diagrams import DrawnDiagram


@dataclass(frozen=True)
class DiagramPrompt:
    id: str
    prompt: str
    # Whether a diagram is the right answer; the control expects none.
    wants_diagram: bool = True


PROMPTS: tuple[DiagramPrompt, ...] = (
    DiagramPrompt(
        "process",
        "Explain how a bill becomes a law in the United States. I'm a visual learner, so include a "
        "diagram of the steps.",
    ),
    DiagramPrompt("cycle", "How does the carbon cycle work? A diagram would help me see it."),
    DiagramPrompt(
        "sequence",
        "What happens, step by step, between my browser and a web server when I open a web page? "
        "Show who sends what to whom.",
    ),
    DiagramPrompt(
        "timeline",
        "Give me a timeline of the main events of the French Revolution, as a diagram.",
    ),
    DiagramPrompt(
        "mind-map",
        "Make a mind map of the three branches of the US government and what each one does.",
    ),
    DiagramPrompt(
        "hierarchy",
        "Show how living things are classified, from domain down to species, as a diagram.",
    ),
    DiagramPrompt("control", "What is the capital of France? One sentence, please.", wants_diagram=False),
)

_ACCESSIBILITY = re.compile(r"^\s*accTitle\s*:|^\s*accDescr\s*[:{]")
# The renderer's name for a diagram without a title: "Diagram" or "Diagram: <type>".
_UNNAMED = re.compile(r"^Diagram(: [A-Za-z][\w-]*)?$")
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1\s*$", re.MULTILINE | re.DOTALL)


def diagram_type(source: str) -> str:
    """The first word of the type line, skipping front matter, comments and accessibility lines."""
    lines = source.splitlines()
    index = 0
    while index < len(lines) and not lines[index].strip():
        index += 1
    if index < len(lines) and lines[index].strip() == "---":
        index += 1
        while index < len(lines) and lines[index].strip() != "---":
            index += 1
        index += 1
    in_block = False
    for line in lines[index:]:
        text = line.strip()
        if in_block:
            in_block = "}" not in text
            continue
        if not text or text.startswith("%%"):
            continue
        if _ACCESSIBILITY.match(line):
            in_block = text.startswith("accDescr") and "{" in text and "}" not in text
            continue
        return text.split()[0]
    return ""


def accessibility_first(source: str) -> bool:
    """Whether an accessibility line comes before the type line (the guidance asks for after)."""
    for line in source.splitlines():
        text = line.strip()
        if not text or text.startswith("%%") or text == "---":
            continue
        return bool(_ACCESSIBILITY.match(line))
    return False


def has_accessibility(source: str) -> bool:
    return any(_ACCESSIBILITY.match(line) for line in source.splitlines())


def words_outside_code(answer: str) -> int:
    return len(_FENCE.sub(" ", answer).split())


@dataclass
class AnswerResult:
    """One answer to one prompt."""

    prompt: str
    wants_diagram: bool
    diagrams: int = 0
    drawn: int = 0
    named: int = 0
    titled: int = 0
    accessibility_first: int = 0
    types: list[str] = field(default_factory=list)
    words: int = 0
    error: str | None = None

    @property
    def passed(self) -> bool:
        """A wanted diagram is there, every diagram draws and is named, and the reply explains it."""
        if self.error:
            return False
        if not self.wants_diagram:
            return self.diagrams == 0
        return self.diagrams > 0 and self.drawn == self.diagrams and self.named == self.diagrams and self.words >= 20


def score(prompt: DiagramPrompt, answer: str, drawn: Sequence["DrawnDiagram | None"]) -> AnswerResult:
    """Score one answer, given the drawn result of each of its mermaid blocks, in order."""
    sources = mermaid_sources(answer)
    if len(drawn) != len(sources):
        raise ValueError("One drawn result is needed per mermaid block")
    return AnswerResult(
        prompt=prompt.id,
        wants_diagram=prompt.wants_diagram,
        diagrams=len(sources),
        drawn=sum(item is not None for item in drawn),
        named=sum(item is not None and not _UNNAMED.match(item.label) for item in drawn),
        titled=sum(has_accessibility(source) for source in sources),
        accessibility_first=sum(accessibility_first(source) for source in sources),
        types=[diagram_type(source) for source in sources],
        words=words_outside_code(answer),
    )
