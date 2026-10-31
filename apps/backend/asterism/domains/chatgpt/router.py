"""ChatGPT plan policy (admin), per-user connection routes, and the OAuth callback."""

from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, CodedException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from . import policy, service
from .availability import PLAN_UNAVAILABLE_MESSAGES
from .plan_models import PlanModelsUnavailable
from .schemas import (
    ChatGPTAuthorizationStart,
    ChatGPTConnection,
    ChatGPTDisconnect,
    ChatGPTDisconnectResult,
    ChatGPTPolicy,
)

chatgpt_router = APIRouter(
    tags=["chatgpt"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 403: {"model": ErrorDetail}},
)
logger = get_logger("ChatGPTPolicy")


@chatgpt_router.get("/settings/app/chatgpt", operation_id="chatgptPolicyGet")
async def get_policy(user: AdminUserDep, session: DBSessionDep) -> ChatGPTPolicy:
    return await policy.read_policy(session)


@chatgpt_router.put("/settings/app/chatgpt", operation_id="chatgptPolicyUpdate")
async def put_policy(payload: ChatGPTPolicy, user: AdminUserDep, session: DBSessionDep) -> ChatGPTPolicy:
    result = await policy.write_policy(payload, session)
    logger.info(f"ChatGPT plan policy set to {result.enabled} by admin {user.id}")
    return result


@chatgpt_router.get("/chatgpt/connection", operation_id="chatgptConnectionGet")
async def get_connection(user: AuthedUserDep, session: DBSessionDep) -> ChatGPTConnection:
    return await service.get_connection(user.id, session)


@chatgpt_router.post("/chatgpt/connection/authorize", operation_id="chatgptConnectionAuthorize")
async def authorize(user: AuthedUserDep, session: DBSessionDep) -> ChatGPTAuthorizationStart:
    return await service.start_authorization(user.id, session)


@chatgpt_router.post("/chatgpt/connection/models", operation_id="chatgptPlanModelsSync")
async def sync_models(user: AuthedUserDep, session: DBSessionDep) -> ChatGPTConnection:
    """Reload the caller's plan models from their ChatGPT account."""
    try:
        return await service.sync_plan_models(user.id, session)
    except service.ChatGPTPlanUnavailable as error:
        raise BadDataException(PLAN_UNAVAILABLE_MESSAGES[error.reason]) from error
    except PlanModelsUnavailable as error:
        raise CodedException(503, "ChatGPT plan models could not be loaded; try again later") from error


@chatgpt_router.post("/chatgpt/connection/resume", operation_id="chatgptPlanUsageResume")
async def resume(user: AuthedUserDep, session: DBSessionDep) -> ChatGPTConnection:
    """Try the plan again after a usage limit paused it."""
    return await service.resume_plan_usage(user.id, session)


@chatgpt_router.post("/chatgpt/connection/notice", operation_id="chatgptPlanNoticeDismiss")
async def dismiss_notice(user: AuthedUserDep, session: DBSessionDep) -> ChatGPTConnection:
    """Dismiss the one-time "You're using your ChatGPT plan" notice."""
    return await service.dismiss_notice(user.id, session)


@chatgpt_router.post("/chatgpt/connection/disconnect", operation_id="chatgptConnectionDisconnect")
async def disconnect(payload: ChatGPTDisconnect, user: AuthedUserDep, session: DBSessionDep) -> ChatGPTDisconnectResult:
    return await service.disconnect(user.id, session, forget=payload.forget)


@chatgpt_router.get("/chatgpt/callback", include_in_schema=False)
async def callback(
    session: DBSessionDep,
    state: Annotated[str | None, Query(max_length=512)] = None,
    code: Annotated[str | None, Query(max_length=4096)] = None,
    client_id: Annotated[str | None, Query(max_length=512)] = None,
    error: Annotated[str | None, Query(max_length=256)] = None,
) -> RedirectResponse:
    """Loopback OAuth callback. Unauthenticated: ``state`` alone identifies the
    single-use attempt and its user. Always redirects back to User Settings."""
    result = await service.complete_authorization(
        service.CallbackParams(state=state, code=code, client_id=client_id, error=error),
        session,
    )
    return RedirectResponse(service.settings_redirect_url(result), status_code=303)
