"""Fixture-based compliance checks for learning modes.

The fixtures track how well a model follows a mode's instructions. Pattern
checks are a rough signal, not a guarantee, and they never gate CI: structural
tests cover pinning and hint state. ``scripts/evaluate_learning_modes.py``
runs the fixtures against a live model.
"""

import re
import uuid
from functools import cached_property
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId
from asterism.domains.agent.prompts import PromptComposer
from asterism.domains.prompt_templates.rubric_catalog import RUBRICS
from asterism.domains.prompt_templates.rubrics import RubricDocument, render_rubric

from .catalog import RubricFeedbackFormat, require_mode
from .rubric_replies import heading_pattern, level_pattern, quoted_notes

FIXTURE_DIR = Path(__file__).parent / "evals"


class EvalMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class EvalCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    hint_level: HintLevel = HintLevel.NONE
    messages: list[EvalMessage] = Field(min_length=1)
    # The reply must contain a question mark (a guiding question).
    ask_question: bool = False
    # Regular expressions that must not match (for example a leaked answer).
    forbidden: list[str] = Field(default_factory=list)
    # Regular expressions that must match.
    required: list[str] = Field(default_factory=list)
    # ``structured``: the reply uses the mode's feedback headings, in order,
    # with one or two follow-up questions. ``free_form``: it uses none of them.
    # ``rubric``: one section per criterion of ``rubric`` with a valid level
    # line, then the overall section, with at least one quoted passage.
    feedback: Literal["structured", "free_form", "rubric"] | None = None
    # A bundled rubric attached to the last user turn, rendered as the model reads it.
    rubric: str | None = None

    @model_validator(mode="after")
    def _valid_patterns(self) -> "EvalCase":
        if self.messages[-1].role != "user":
            raise ValueError("A case must end with a user message")
        for pattern in (*self.forbidden, *self.required):
            re.compile(pattern)
        if self.rubric is not None and self.rubric not in RUBRICS:
            raise ValueError(f"Unknown bundled rubric {self.rubric!r}")
        if self.feedback == "rubric" and self.rubric is None:
            raise ValueError("Rubric feedback checks need a rubric")
        return self

    @property
    def rubric_document(self) -> RubricDocument | None:
        return RUBRICS[self.rubric].document if self.rubric else None

    def api_messages(self) -> list[dict[str, str]]:
        """The conversation as sent to the model; a rubric follows the last user text."""
        items = [message.model_dump() for message in self.messages]
        if self.rubric_document is not None:
            items[-1]["content"] += "\n\n" + render_rubric(self.rubric_document)
        return items


class EvalSuite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: LearningModeId
    cases: list[EvalCase] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_ids(self) -> "EvalSuite":
        ids = [case.id for case in self.cases]
        if len(ids) != len(set(ids)):
            raise ValueError("Case IDs must be unique")
        return self

    @model_validator(mode="after")
    def _feedback_needs_sections(self) -> "EvalSuite":
        if self.rubric_format is not None:
            if any(case.feedback == "structured" for case in self.cases):
                raise ValueError("Rubric feedback modes use rubric checks, not structured ones")
        elif any(case.feedback for case in self.cases) and not self.feedback_headings:
            raise ValueError("Feedback checks need a mode with feedback sections")
        return self

    @property
    def feedback_headings(self) -> tuple[str, ...]:
        return tuple(section.heading for section in require_mode(self.mode).feedback_sections)

    @property
    def rubric_format(self) -> RubricFeedbackFormat | None:
        return require_mode(self.mode).rubric_feedback

    @cached_property
    def system_prompts(self) -> dict[HintLevel, str]:
        """The platform and mode layers each hint level is evaluated under."""
        definition = require_mode(self.mode)
        return {
            level: PromptComposer()
            .snapshot(
                agent_id=uuid.UUID(int=0),
                agent_revision=1,
                agent_instructions="",
                mode_layer=definition.snapshot(level).layer,
            )
            .text
            for level in HintLevel
        }


class CaseResult(BaseModel):
    id: str
    passed: bool
    failures: list[str] = Field(default_factory=list)


def load_suites() -> list[EvalSuite]:
    return [EvalSuite.model_validate_json(path.read_text()) for path in sorted(FIXTURE_DIR.glob("*.json"))]


def _feedback_failures(feedback: str, headings: tuple[str, ...], reply: str) -> list[str]:
    matches = [heading_pattern(heading).search(reply) for heading in headings]
    if feedback == "free_form":
        return [f"used feedback heading {heading!r}" for heading, match in zip(headings, matches) if match]
    missing = [heading for heading, match in zip(headings, matches) if not match]
    if missing:
        return [f"missing feedback heading {heading!r}" for heading in missing]
    starts = [match.start() for match in matches if match]
    if starts != sorted(starts):
        return ["feedback headings out of order"]
    # The last section holds the follow-up questions.
    questions = reply[matches[-1].end() :].count("?")
    return [] if 1 <= questions <= 2 else [f"expected one or two follow-up questions, found {questions}"]


def _rubric_failures(
    feedback: str, rubric: RubricDocument | None, rubric_format: RubricFeedbackFormat, reply: str
) -> list[str]:
    level_line = level_pattern(rubric_format.level_label)
    overall = heading_pattern(rubric_format.overall_heading).search(reply)
    if feedback == "free_form":
        failures = ["used the overall heading"] if overall else []
        return failures + (["used a level line"] if level_line.search(reply) else [])
    assert rubric is not None
    headings = [criterion.label for criterion in rubric.criteria]
    matches = [heading_pattern(heading).search(reply) for heading in headings]
    failures = [f"missing criterion heading {heading!r}" for heading, match in zip(headings, matches) if not match]
    if overall is None:
        failures.append(f"missing heading {rubric_format.overall_heading!r}")
    if failures:
        return failures
    starts = [match.start() for match in matches if match] + [overall.start()]
    if starts != sorted(starts):
        return ["rubric headings out of order"]
    levels = {" ".join(level.split()).casefold() for level in rubric.levels}
    for heading, start, end in zip(headings, starts, starts[1:]):
        found = level_line.search(reply, start, end)
        if found is None:
            failures.append(f"no level line for {heading!r}")
        elif " ".join(found.group(1).strip(" *.").split()).casefold() not in levels:
            failures.append(f"unknown level {found.group(1)!r} for {heading!r}")
    if not any(pair.note for pair in quoted_notes(reply)):
        failures.append("no quoted passage with a note")
    return failures


def score(
    case: EvalCase,
    reply: str,
    *,
    feedback_headings: tuple[str, ...] = (),
    rubric_format: RubricFeedbackFormat | None = None,
) -> CaseResult:
    failures = []
    if case.feedback and rubric_format is not None:
        failures += _rubric_failures(case.feedback, case.rubric_document, rubric_format, reply)
    elif case.feedback:
        failures += _feedback_failures(case.feedback, feedback_headings, reply)
    if case.ask_question and "?" not in reply:
        failures.append("expected a guiding question")
    failures += [f"matched forbidden {pattern!r}" for pattern in case.forbidden if re.search(pattern, reply)]
    failures += [f"missing required {pattern!r}" for pattern in case.required if not re.search(pattern, reply)]
    return CaseResult(id=case.id, passed=not failures, failures=failures)
