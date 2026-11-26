"""US-108.2: scoring diagram answers from a live model (no model or browser needed)."""

import pytest
from asterism.domains.canvas.diagrams import DrawnDiagram
from asterism.domains.chat.diagram_evaluation import (
    PROMPTS,
    DiagramPrompt,
    accessibility_first,
    diagram_type,
    score,
)

PROCESS = DiagramPrompt("process", "Explain it with a diagram.")
CONTROL = DiagramPrompt("control", "Capital of France?", wants_diagram=False)
EXPLANATION = (
    "A bill starts as an idea, goes to a committee for review, then both chambers vote on it and the "
    "President signs it into law."
)


def drawn(label: str) -> DrawnDiagram:
    return DrawnDiagram(png=b"", width=1, height=1, label=label, description=None)


def answer(*sources: str) -> str:
    return EXPLANATION + "\n\n" + "\n\n".join(f"```mermaid\n{source}```" for source in sources) + "\n"


FIRST = "accTitle: Bill\naccDescr: Steps\nflowchart TD\n  a --> b\n"
AFTER = "flowchart TD\n  accTitle: Bill\n  a --> b\n"


def test_the_prompts_cover_each_kind_and_a_control():
    assert [prompt.id for prompt in PROMPTS] == [
        "process",
        "cycle",
        "sequence",
        "timeline",
        "mind-map",
        "hierarchy",
        "control",
    ]
    assert [prompt.wants_diagram for prompt in PROMPTS].count(False) == 1


def test_a_named_drawn_explained_diagram_passes():
    result = score(PROCESS, answer(AFTER), [drawn("Bill")])
    assert (result.diagrams, result.drawn, result.named, result.titled) == (1, 1, 1, 1)
    assert result.accessibility_first == 0 and result.types == ["flowchart"]
    assert result.words >= 20 and result.passed


def test_each_way_to_fail():
    assert not score(PROCESS, EXPLANATION, []).passed  # No diagram.
    assert not score(PROCESS, answer(AFTER), [None]).passed  # Didn't draw.
    unnamed = score(PROCESS, answer("flowchart TD\n  a --> b\n"), [drawn("Diagram: flowchart")])
    assert unnamed.named == 0 and not unnamed.passed
    bare = score(PROCESS, "```mermaid\n" + AFTER + "```\n", [drawn("Bill")])
    assert bare.words == 0 and not bare.passed  # No explanation in words.
    # Out of order still passes (the renderer moves the lines), but is counted.
    first = score(PROCESS, answer(FIRST), [drawn("Bill")])
    assert first.accessibility_first == 1 and first.passed


def test_a_real_title_starting_with_diagram_counts_as_named():
    assert score(PROCESS, answer(AFTER), [drawn("Diagram of the water cycle")]).named == 1


def test_the_control_passes_only_without_a_diagram():
    assert score(CONTROL, "Paris.", []).passed
    assert not score(CONTROL, answer(AFTER), [drawn("Bill")]).passed


def test_one_drawn_result_per_block():
    with pytest.raises(ValueError):
        score(PROCESS, answer(AFTER), [])


def test_type_and_order_reading():
    assert diagram_type(FIRST) == "flowchart"
    assert diagram_type("---\ntitle: x\n---\n%% note\naccDescr {\n  a\n  b\n}\nmindmap\n  root\n") == "mindmap"
    assert diagram_type("") == ""
    assert accessibility_first(FIRST) and not accessibility_first(AFTER)
    assert accessibility_first("\n%% comment\naccDescr {\n x\n}\ntimeline\n")
