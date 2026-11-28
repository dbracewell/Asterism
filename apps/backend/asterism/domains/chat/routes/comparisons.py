"""Comparison routes: reading comparisons, their disagreements and the active column."""

import uuid

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from ..disagreement_schemas import DisagreementRequest, DisagreementSummary
from ..schemas import (
    ChatComparison,
    ComparisonActivate,
)

router = APIRouter()


@router.get(
    "/{chat_id}/comparisons/{comparison_id}",
    response_model=ChatComparison,
    operation_id="chatComparisonGetOne",
)
async def get_comparison(
    chat_id: uuid.UUID, comparison_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> ChatComparison:
    from ..comparisons import read_comparison

    return await read_comparison(user_id=user.id, chat_id=chat_id, comparison_id=comparison_id, session=db)


@router.post(
    "/{chat_id}/comparisons/{comparison_id}/disagreements",
    response_model=DisagreementSummary,
    operation_id="chatComparisonDisagreementsFind",
)
async def find_comparison_disagreements(
    chat_id: uuid.UUID, comparison_id: uuid.UUID, payload: DisagreementRequest, user: AuthedUserDep, db: DBSessionDep
) -> DisagreementSummary:
    """List where a comparison's answered columns disagree; owner only (US-55.3)."""
    from ..disagreements import compare_columns

    return await compare_columns(
        user_id=user.id, chat_id=chat_id, comparison_id=comparison_id, request=payload, session=db
    )


@router.put(
    "/{chat_id}/comparisons/{comparison_id}/active",
    response_model=ChatComparison,
    operation_id="chatComparisonActivate",
    responses={409: {"model": ErrorDetail}},
)
async def activate_comparison_column(
    chat_id: uuid.UUID,
    comparison_id: uuid.UUID,
    payload: ComparisonActivate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatComparison:
    """Continue the conversation from another column."""
    from ..comparisons import activate_column

    return await activate_column(
        user_id=user.id, chat_id=chat_id, comparison_id=comparison_id, payload=payload, session=db
    )
