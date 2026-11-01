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

from .catalog import require_mode

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
    feedback: Literal["structured", "free_form"] | None = None

    @model_validator(mode="after")
    def _valid_patterns(self) -> "EvalCase":
        if self.messages[-1].role != "user":
            raise ValueError("A case must end with a user message")
        for pattern in (*self.forbidden, *self.required):
            re.compile(pattern)
        return self


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
        if any(case.feedback for case in self.cases) and not self.feedback_headings:
            raise ValueError("Feedback checks need a mode with feedback sections")
        return self

    @property
    def feedback_headings(self) -> tuple[str, ...]:
        return tuple(section.heading for section in require_mode(self.mode).feedback_sections)

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


def _heading_pattern(heading: str) -> re.Pattern[str]:
    """A Markdown heading line (any level, optionally bold) with this text."""
    return re.compile(rf"(?im)^\s*#{{1,6}}\s*(?:\*\*)?{re.escape(heading)}(?:\*\*)?\s*:?\s*$")


def _feedback_failures(feedback: str, headings: tuple[str, ...], reply: str) -> list[str]:
    matches = [_heading_pattern(heading).search(reply) for heading in headings]
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


def score(case: EvalCase, reply: str, *, feedback_headings: tuple[str, ...] = ()) -> CaseResult:
    failures = []
    if case.feedback:
        failures += _feedback_failures(case.feedback, feedback_headings, reply)
    if case.ask_question and "?" not in reply:
        failures.append("expected a guiding question")
    failures += [f"matched forbidden {pattern!r}" for pattern in case.forbidden if re.search(pattern, reply)]
    failures += [f"missing required {pattern!r}" for pattern in case.required if not re.search(pattern, reply)]
    return CaseResult(id=case.id, passed=not failures, failures=failures)
