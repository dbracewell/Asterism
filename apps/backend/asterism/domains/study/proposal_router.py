"""The person's chat drafts of decks and quizzes: read, save or dismiss (EPIC-98, ADR-0080)."""

import uuid

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import proposals
from .proposal_schemas import StudyProposal, StudyProposalSave

study_proposal_router = APIRouter(
    prefix="/study/proposals",
    tags=["study"],
    responses={
        400: {"model": ErrorDetail},
        401: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
    },
)


@study_proposal_router.get("/{proposal_id}", operation_id="studyProposalGetOne")
async def get_proposal(proposal_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> StudyProposal:
    return await proposals.read_proposal(user.id, proposal_id, session)


@study_proposal_router.post("/{proposal_id}/save", operation_id="studyProposalSave", status_code=201)
async def save_proposal(
    proposal_id: uuid.UUID, payload: StudyProposalSave, user: AuthedUserDep, session: DBSessionDep
) -> StudyProposal:
    """Save the draft to Study, as drafted or edited. The chat, project, switches and citations are checked now."""
    return await proposals.save_proposal(user.id, proposal_id, payload, session)


@study_proposal_router.post("/{proposal_id}/dismiss", operation_id="studyProposalDismiss")
async def dismiss_proposal(proposal_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> StudyProposal:
    return await proposals.dismiss_proposal(user.id, proposal_id, session)
