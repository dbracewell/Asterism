"""One effective learning-mode policy per chat; the stricter rule wins (ADR-0068).

Two sources restrict a chat: the learner's own lock (``chats.learning_mode_locked``,
ADR-0031) and the class policy of a course project (ADR-0055). Both are read live
on every call and combined here. Sends, mode changes, hint requests and every run
check the same policy, and refusals share one 409 shape naming each source.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import ConflictException
from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId
from asterism.domains.learning.catalog import LEARNING_MODES

from .mode_policy_schemas import ModePolicy, ModePolicySource, ModePolicySourceKind, ModeReveal
from .models import ChatModel


class ModePolicyConflict(ConflictException):
    """HTTP 409: the effective mode policy refuses this; the detail names each source."""

    reason = "mode_policy"


def _catalog() -> list[LearningModeId]:
    return [mode for mode in LearningModeId if mode in LEARNING_MODES]


def _learner_source() -> ModePolicySource:
    return ModePolicySource(
        kind=ModePolicySourceKind.LEARNER,
        set_by="You",
        allowed_modes=[mode for mode in _catalog() if mode != LearningModeId.STANDARD],
        reveal=ModeReveal.OVERRIDE_REQUIRED,
        learner_can_lift=True,
    )


async def _course_source(*, user_id: str, project_id: uuid.UUID | None, session: AsyncSession):
    from asterism.domains.courses.policy import course_mode_policy

    course = await course_mode_policy(user_id=user_id, project_id=project_id, session=session)
    if course is None:
        return None
    return ModePolicySource(
        kind=ModePolicySourceKind.COURSE,
        set_by=course.educator_name,
        class_name=course.class_name,
        allowed_modes=[mode for mode in _catalog() if course.allows(mode)],
        reveal=ModeReveal.ALLOWED if course.answer_reveal else ModeReveal.FORBIDDEN,
        learner_can_lift=False,
    )


async def mode_policy_for(
    *, user_id: str, project_id: uuid.UUID | None, locked: bool, session: AsyncSession
) -> ModePolicy:
    """Combine the sources: modes intersect, and the strictest reveal wins."""
    sources = [
        source
        for source in (
            await _course_source(user_id=user_id, project_id=project_id, session=session),
            _learner_source() if locked else None,
        )
        if source is not None
    ]
    allowed = [mode for mode in _catalog() if all(mode in source.allowed_modes for source in sources)]
    reveal = max((source.reveal for source in sources), key=lambda item: item.rank, default=ModeReveal.ALLOWED)
    return ModePolicy(allowed_modes=allowed, reveal=reveal, sources=sources)


async def effective_mode_policy(*, user_id: str, chat: ChatModel, session: AsyncSession) -> ModePolicy:
    """The live policy for one of the user's chats."""
    return await mode_policy_for(
        user_id=user_id, project_id=chat.project_id, locked=chat.learning_mode_locked, session=session
    )


def _mode_names(modes: list[LearningModeId]) -> str:
    names = [LEARNING_MODES[mode].name for mode in modes]
    if not names:
        return "no mode"
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} or {names[-1]}"


def _refusal(source: ModePolicySource, *, mode_refused: bool) -> str:
    if source.kind == ModePolicySourceKind.LEARNER:
        return (
            "You locked this chat" if mode_refused else "You locked this chat; confirm the override to show the answer"
        )
    who = f"{source.class_name} ({source.set_by})"
    if mode_refused:
        return f"{who}: {_mode_names(source.allowed_modes)} only"
    return f"{who}: answers can't be revealed"


def require_allowed(
    policy: ModePolicy, *, mode: LearningModeId | str, reveal: bool = False, override_lock: bool = False
) -> None:
    """The one check. ``override_lock`` lifts only the learner's own source."""
    mode = LearningModeId(mode)
    reasons: list[str] = []
    for source in policy.sources:
        if override_lock and source.learner_can_lift:
            continue
        if mode not in source.allowed_modes:
            reasons.append(_refusal(source, mode_refused=True))
        elif reveal and source.reveal != ModeReveal.ALLOWED:
            reasons.append(_refusal(source, mode_refused=False))
    if not reasons:
        return
    if not policy.allowed_modes and policy.source(ModePolicySourceKind.LEARNER) and not override_lock:
        reasons.append("No mode is left while this chat is locked; unlock it to continue")
    raise ModePolicyConflict(f"Not allowed by this chat's mode policy. {'. '.join(reasons)}.")


async def accept_send_level(
    *,
    user_id: str,
    chat: ChatModel,
    hint_level: HintLevel,
    request_reveal: bool,
    override_lock: bool,
    session: AsyncSession,
) -> HintLevel:
    """Check a send and return the hint level it carries.

    An explicit reveal needs every source to allow it (the learner's with the
    override). A branch already at the answer continues one level below it when
    reveals are forbidden, so an earlier reveal does not block the branch.
    """
    policy = await effective_mode_policy(user_id=user_id, chat=chat, session=session)
    require_allowed(policy, mode=chat.learning_mode, reveal=request_reveal, override_lock=override_lock)
    if hint_level == HintLevel.ANSWER and not request_reveal and policy.reveal == ModeReveal.FORBIDDEN:
        return HintLevel.WORKED_EXAMPLE
    return hint_level


async def require_run_allowed(
    *, user_id: str, chat: ChatModel, mode: LearningModeId, hint_level: HintLevel | None, session: AsyncSession
) -> None:
    """The live check before every run, including resume and regeneration.

    The learner's lock gated the turn when it was accepted, so a run checks only
    the sources the learner cannot lift.
    """
    policy = await effective_mode_policy(user_id=user_id, chat=chat, session=session)
    require_allowed(policy, mode=mode, reveal=hint_level == HintLevel.ANSWER, override_lock=True)
