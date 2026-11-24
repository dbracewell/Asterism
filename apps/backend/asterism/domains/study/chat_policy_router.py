"""Admin endpoints for the decks-and-quizzes-from-chat policy (EPIC-98)."""

from fastapi import APIRouter

from asterism.common.log import get_logger
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from .chat_policy import read_policy, write_policy
from .chat_policy_schemas import StudyChatPolicy

logger = get_logger("StudyChatPolicy")

study_chat_policy_router = APIRouter(
    prefix="/settings/app/study-chat",
    tags=["study"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 403: {"model": ErrorDetail}},
)


@study_chat_policy_router.get("", operation_id="studyChatPolicyGet")
async def get_policy(user: AdminUserDep, session: DBSessionDep) -> StudyChatPolicy:
    return await read_policy(session)


@study_chat_policy_router.put("", operation_id="studyChatPolicyUpdate")
async def put_policy(payload: StudyChatPolicy, user: AdminUserDep, session: DBSessionDep) -> StudyChatPolicy:
    result = await write_policy(payload, session)
    logger.info(f"Study chat policy set by admin {user.id}: enabled={result.enabled} groups={result.group_ids}")
    return result
