"""propose_deck and propose_quiz for the main agent (EPIC-98, ADR-0080).

Context-managed: offered in a project's conversations whose Study area is on,
while the admin and class switches allow it and the chat model supports tools;
never to sub-agents or in drafting chats. The tools only draft: the person sees
a card and decides, and nothing reaches Study without their click. One draft of
each kind per turn. Refusals come back as errors with a reason, and results
carry the draft's id and size, never its text.
"""

from typing import Any

from asterism.core.exceptions import BadDataException
from asterism.domains.study.proposal_schemas import StudyDeckDraft, StudyQuizDraft
from asterism.domains.tools.registry import ToolContext, tool_registry

DECK_TOOL_DESCRIPTION = (
    "Draft a new flashcard deck for this project's Study area when the person asks for flashcards or a deck. "
    "The person sees the draft as a card, can edit it, and chooses to save or dismiss it; nothing is saved "
    "unless they do. Write each card as one clear question or term on the front and a short answer on the "
    "back, from what this chat and the project's files say. Cite a file by its id only when the card comes "
    "from it. At most one deck per turn, up to 30 cards."
)

QUIZ_TOOL_DESCRIPTION = (
    "Draft a new practice quiz for this project's Study area when the person asks for a quiz or practice "
    "questions. The person sees the draft as a card, can edit it, and chooses to save or dismiss it; nothing "
    "is saved unless they do. Use multiple_choice questions (2 to 6 different options and the index of the "
    "correct one) or short_answer questions (a rubric saying what a good answer contains), each with a short "
    "explanation. Cite a file by its id only when the question comes from it. At most one quiz per turn, up "
    "to 20 questions."
)


async def _record(ctx: ToolContext[Any], draft: StudyDeckDraft | StudyQuizDraft) -> dict[str, object]:
    from asterism.db.database import get_async_db_session
    from asterism.domains.study.proposals import ProposalRun, record_proposal

    scope = ctx.execution_scope
    if (
        scope is None
        or scope.is_sub_agent
        or scope.project_id is None
        or scope.request_message_id is None
        or scope.execution_id is None
        or scope.user_id != ctx.user.id
        or scope.chat_id != ctx.session.info.id
    ):
        return {"error": "Drafting decks and quizzes is unavailable outside a recorded main-agent run"}
    run = ProposalRun(
        user_id=scope.user_id,
        chat_id=scope.chat_id,
        project_id=scope.project_id,
        message_id=scope.request_message_id,
        execution_id=scope.execution_id,
        allowed_file_ids=scope.allowed_file_ids,
    )
    try:
        async with get_async_db_session() as session:
            proposal = await record_proposal(run, draft, session)
    except BadDataException as exc:
        return {"error": str(exc)}
    size = len(draft.cards) if isinstance(draft, StudyDeckDraft) else len(draft.questions)
    return {
        "proposal_id": str(proposal.id),
        "kind": proposal.kind,
        "items": size,
        "status": "pending",
        "note": "The person sees the draft to edit, save to Study or dismiss. Mention briefly that you "
        "drafted it; don't repeat its contents in your reply.",
    }


@tool_registry.tool(name="propose_deck", description=DECK_TOOL_DESCRIPTION)
async def propose_deck(ctx: ToolContext[StudyDeckDraft]) -> dict[str, object]:
    return await _record(ctx, ctx.args)


@tool_registry.tool(name="propose_quiz", description=QUIZ_TOOL_DESCRIPTION)
async def propose_quiz(ctx: ToolContext[StudyQuizDraft]) -> dict[str, object]:
    return await _record(ctx, ctx.args)
