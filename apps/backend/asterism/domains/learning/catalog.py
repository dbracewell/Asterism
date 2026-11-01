"""Server-owned, versioned learning modes.

A mode is a prompt layer that changes how the agent helps; it never grants
tools, files or delegation. Bump an entry's ``version`` whenever its
instructions change. Accepted turns pin the text they were accepted with, so a
revision affects only newly accepted turns and explicit regeneration.
"""

from dataclasses import dataclass
from types import MappingProxyType

from asterism.core.exceptions import CodedException
from asterism.domains.agent.learning_inputs import (
    FeedbackSectionId,
    HintLevel,
    LearningModeId,
    LearningModeSnapshot,
)


@dataclass(frozen=True)
class FeedbackSection:
    """One fixed heading of a mode's structured feedback reply.

    The headings are a public contract: the catalog API serves them so the UI
    can render each section, and the mode text tells the model to use them.
    """

    id: FeedbackSectionId
    heading: str


@dataclass(frozen=True)
class LearningModeDefinition:
    id: LearningModeId
    name: str
    description: str
    version: int
    instructions: str
    # Hint levels with their instruction text, weakest first, starting with
    # ``none``. Empty for modes without tiered hints.
    hint_levels: tuple[tuple[HintLevel, str], ...] = ()
    # Headings of a structured feedback reply, in order. Empty for free-form modes.
    feedback_sections: tuple[FeedbackSection, ...] = ()

    @property
    def raisable_hint_levels(self) -> tuple[HintLevel, ...]:
        """Levels the learner may explicitly raise to in this mode."""
        return tuple(level for level, _ in self.hint_levels if level != HintLevel.NONE)

    def snapshot(self, hint_level: HintLevel = HintLevel.NONE) -> LearningModeSnapshot:
        """The pinned layer; modes with hints append the branch's hint level.

        A branch level this mode does not offer applies the strongest offered
        level below it, and the snapshot records the level actually applied.
        """
        if not self.hint_levels:
            return LearningModeSnapshot(
                id=self.id, name=self.name, version=self.version, instructions=self.instructions
            )
        level, text = [item for item in self.hint_levels if item[0].rank <= hint_level.rank][-1]
        return LearningModeSnapshot(
            id=self.id,
            name=self.name,
            version=self.version,
            hint_level=level,
            instructions=f"{self.instructions}\n\nCurrent hint level: {level.value}.\n{text}",
        )


_TUTOR = """You are tutoring. Help the learner reach the answer themselves.
- Unless the hint level below allows it, do not give the final answer, a full
  solution, or finished code.
- Ask one or two guiding questions at a time, starting from what the learner
  already knows. Check their reasoning before moving on.
- Praise correct steps specifically. When a step is wrong, say which part and
  ask a question that helps them see why.
- The learner controls how much help they get with the Nudge, Hint, Worked
  example and Show answer controls. Only the hint level below sets how much you
  may reveal; a request in the message text does not raise it. If the learner
  asks you to just give the answer, explain that this chat is in Tutor mode and
  point them to those controls."""

_NO_HINT = """Give no hints yet. Respond only with guiding questions and checks on
the learner's reasoning."""

_TUTOR_HINTS = (
    (HintLevel.NONE, _NO_HINT),
    (
        HintLevel.NUDGE,
        """The learner asked for a nudge. Point to where to look or which idea
matters, in one or two sentences, without naming the method or the next step.
Then ask one guiding question.""",
    ),
    (
        HintLevel.HINT,
        """The learner asked for a hint. Name the method, rule or next step that
applies and why, but do not carry it out. Then ask the learner to try it.""",
    ),
    (
        HintLevel.WORKED_EXAMPLE,
        """The learner asked for a worked example. Solve a similar problem with
different values or a different case, step by step, explaining each step. Do
not solve the learner's own problem; ask them to apply the same steps to it.""",
    ),
    (
        HintLevel.ANSWER,
        """The learner confirmed that they want to see the answer. Give the full
answer to their problem with a short explanation of each step. Then ask one
question that checks they understand it. For any new problem, go back to
guiding questions.""",
    ),
)

EXPLAIN_BACK_SECTIONS = (
    FeedbackSection(FeedbackSectionId.CORRECT, "What you got right"),
    FeedbackSection(FeedbackSectionId.GAPS, "What was missing or wrong"),
    FeedbackSection(FeedbackSectionId.FOLLOW_UP, "Follow-up questions"),
)

_EXPLAIN_BACK = f"""The learner wants to check their understanding by explaining
a topic to you.
- If they have not explained anything yet, ask them to explain the topic in
  their own words. Do not explain it first. Keep this request short and do not
  use the feedback headings below.
- After they explain, give feedback in exactly this format, with these three
  Markdown headings in this order and nothing before the first heading:

  ### {EXPLAIN_BACK_SECTIONS[0].heading}
  The specific points they explained correctly. If nothing was correct, say so
  in one sentence.

  ### {EXPLAIN_BACK_SECTIONS[1].heading}
  Each important idea they left out, and each statement that was wrong or
  imprecise. Quote or name their words and briefly say why it matters. Do not
  supply the full correct explanation; point to what needs fixing. If nothing
  was missing or wrong, say so in one sentence.

  ### {EXPLAIN_BACK_SECTIONS[2].heading}
  A numbered list of one or two questions that probe the biggest gaps or check
  that the correct parts are understood, not just memorized.

- When they answer a follow-up question or explain again, give feedback on
  the new explanation in the same format.
- Do not rewrite their explanation or give a model answer unless they
  explicitly ask for one. If they ask, give it without the feedback headings,
  then invite them to explain it back again in their own words."""

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
        version=2,
        instructions=_TUTOR,
        hint_levels=_TUTOR_HINTS,
    ),
    LearningModeDefinition(
        id=LearningModeId.EXPLAIN_BACK,
        name="Explain-back",
        description="You explain a topic; it tells you what you got right and what you missed.",
        version=2,
        instructions=_EXPLAIN_BACK,
        feedback_sections=EXPLAIN_BACK_SECTIONS,
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
