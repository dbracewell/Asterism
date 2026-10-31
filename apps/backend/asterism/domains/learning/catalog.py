"""Server-owned, versioned learning modes.

A mode is a prompt layer that changes how the agent helps; it never grants
tools, files or delegation. Bump an entry's ``version`` whenever its
instructions change. Accepted turns pin the text they were accepted with, so a
revision affects only newly accepted turns and explicit regeneration.
"""

from dataclasses import dataclass
from types import MappingProxyType

from asterism.core.exceptions import CodedException
from asterism.domains.agent.learning_inputs import LearningModeId, LearningModeSnapshot


@dataclass(frozen=True)
class LearningModeDefinition:
    id: LearningModeId
    name: str
    description: str
    version: int
    instructions: str

    def snapshot(self) -> LearningModeSnapshot:
        return LearningModeSnapshot(id=self.id, name=self.name, version=self.version, instructions=self.instructions)


_TUTOR = """You are tutoring. Help the learner reach the answer themselves.
- Do not give the final answer, a full solution, or finished code.
- Ask one or two guiding questions at a time, starting from what the learner
  already knows. Check their reasoning before moving on.
- When the learner is stuck, offer a small hint that points to the next step,
  not the whole path.
- Praise correct steps specifically. When a step is wrong, say which part and
  ask a question that helps them see why.
- If the learner asks you to just give the answer, explain that this chat is in
  Tutor mode and offer a stronger hint instead."""

_EXPLAIN_BACK = """The learner wants to check their understanding by explaining
a topic to you.
- If they have not explained anything yet, ask them to explain the topic in
  their own words. Do not explain it first.
- After they explain, reply with: what they got right, what was missing or
  wrong, and one or two follow-up questions that probe the gaps.
- Do not rewrite their explanation or give a model answer unless they ask."""

_REVIEW = """The learner wants feedback on their own attempt (for example a
math solution, code, or an essay excerpt), not a finished solution.
- If they have not shared an attempt yet, ask for it.
- Find the first error or the weakest point. Quote or point to it, explain why
  it is a problem, and suggest one concrete next step.
- Note what already works, briefly.
- Do not write a full corrected solution or rewrite the whole attempt."""

_DEFINITIONS = (
    LearningModeDefinition(
        id=LearningModeId.STANDARD,
        name="Standard",
        description="Answers your questions directly.",
        version=1,
        instructions="",
    ),
    LearningModeDefinition(
        id=LearningModeId.TUTOR,
        name="Tutor",
        description="Guides you with questions and hints instead of giving answers.",
        version=1,
        instructions=_TUTOR,
    ),
    LearningModeDefinition(
        id=LearningModeId.EXPLAIN_BACK,
        name="Explain-back",
        description="You explain a topic; it tells you what you got right and what you missed.",
        version=1,
        instructions=_EXPLAIN_BACK,
    ),
    LearningModeDefinition(
        id=LearningModeId.REVIEW,
        name="Review my work",
        description="Gives feedback on your attempt instead of a finished solution.",
        version=1,
        instructions=_REVIEW,
    ),
)

LEARNING_MODES: MappingProxyType[LearningModeId, LearningModeDefinition] = MappingProxyType(
    {item.id: item for item in _DEFINITIONS}
)


def require_mode(mode_id: LearningModeId | str) -> LearningModeDefinition:
    """The live definition; a retired or unknown mode blocks execution with 409."""
    try:
        return LEARNING_MODES[LearningModeId(mode_id)]
    except (KeyError, ValueError) as error:
        raise CodedException(409, "Learning mode is unavailable; choose another mode") from error


def recheck_pinned(snapshot: LearningModeSnapshot) -> None:
    """Pinned text is replayed as recorded, but the mode must still be offered."""
    require_mode(snapshot.id)
