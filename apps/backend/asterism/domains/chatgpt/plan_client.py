"""LLM client for one user's ChatGPT plan, with plan-specific error recovery.

Wraps :class:`ResponsesLLMClient` and applies the plan error rules before any
output reaches the caller:

- usage limit (``subscription_sharing_usage_limit_exceeded``): pause the
  owner's plan requests until they explicitly try again;
- usage or user temporarily unavailable (503): retry with bounded backoff;
- rejected subscriber (401): refresh the token once and retry; ask the user to
  sign in again only after a terminal refresh error.

Every plan failure ends as one ``ERROR`` event whose ``LLMProviderError.code``
is a stable ``chatgpt_plan_<reason>`` value the UI maps to recovery actions.
Nothing falls back to another provider.
"""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Type, Unpack

from pydantic import BaseModel

from asterism.common.log import get_logger
from asterism.domains.llm.capabilities import CHATGPT_PLAN_CAPABILITIES
from asterism.domains.llm.errors import LLMProviderError
from asterism.domains.llm.responses import ResponsesLLMClient, ResponsesStreamHandler
from asterism.domains.llm.schemas import (
    ChatCompletionParams,
    LLMClientProtocol,
    LLMEvent,
    LLMEventType,
    LLMMessage,
)

from . import service
from .availability import PLAN_UNAVAILABLE_MESSAGES, PlanUnavailableReason

logger = get_logger("ChatGPTPlanClient")

# Placeholder pool key: every request replaces it with the owner's token.
PLAN_POOL_KEY = "chatgpt-plan"
USAGE_LIMIT_CODE = "subscription_sharing_usage_limit_exceeded"
TEMPORARY_CODES = frozenset({"subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable"})
INVALID_USER_CODE = "subscription_sharing_invalid_user"
NOT_ELIGIBLE_CODE = "subscription_sharing_user_not_eligible"
# Seconds before each retry of a temporarily unavailable plan (bounded).
RETRY_DELAYS: tuple[float, ...] = (1.0, 2.0, 4.0)


def plan_error_code(reason: PlanUnavailableReason | str) -> str:
    return f"chatgpt_plan_{reason}"


def _plan_error(reason: PlanUnavailableReason, *, cause: LLMProviderError | None = None) -> LLMEvent:
    error = LLMProviderError(
        PLAN_UNAVAILABLE_MESSAGES[reason],
        code=plan_error_code(reason),
        status=cause.status if cause else None,
        request_id=cause.request_id if cause else None,
    )
    return ResponsesStreamHandler()._error(error)


class ChatGPTPlanClient(LLMClientProtocol):
    """Runs one model on ``owner_user_id``'s plan, and only on that connection."""

    def __init__(self, *, model_name: str, base_url: str, owner_user_id: str) -> None:
        self.model_name = model_name
        self.base_url = base_url
        self.owner_user_id = owner_user_id

    def _attempt_client(self, *, force_refresh: bool) -> ResponsesLLMClient:
        async def token() -> str:
            try:
                return (await service.access_token(self.owner_user_id, force_refresh=force_refresh)).access_token
            except service.ChatGPTPlanUnavailable as error:
                raise LLMProviderError(
                    PLAN_UNAVAILABLE_MESSAGES[error.reason], code=plan_error_code(error.reason)
                ) from error

        return ResponsesLLMClient(
            model_name=self.model_name,
            api_key=PLAN_POOL_KEY,
            base_url=self.base_url,
            capabilities=CHATGPT_PLAN_CAPABILITIES,
            access_token=token,
        )

    async def chat[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[T], None]:
        """Stream one plan response, recovering from plan errors before output."""
        retries = 0
        refreshed = False
        while True:
            client = self._attempt_client(force_refresh=refreshed and retries == 0)
            emitted = False
            failure: LLMProviderError | None = None
            async for event in client.chat(messages=messages, tools=tools, response_model=response_model, **kwargs):
                if event.type == LLMEventType.ERROR and isinstance(event.exception, LLMProviderError):
                    failure = event.exception
                    if emitted or not self._recoverable(failure, retries=retries, refreshed=refreshed):
                        yield await self._final_error(event, failure)
                        return
                    break
                emitted = True
                yield event
            if failure is None:
                return

            if failure.code in TEMPORARY_CODES or failure.status == 503:
                delay = RETRY_DELAYS[retries]
                retries += 1
                logger.info("ChatGPT plan unavailable; retry %d in %.1fs user=%s", retries, delay, self.owner_user_id)
                await asyncio.sleep(delay)
            else:
                refreshed = True
                retries = 0
                logger.info("ChatGPT plan rejected the session; refreshing once user=%s", self.owner_user_id)

    def _recoverable(self, failure: LLMProviderError, *, retries: int, refreshed: bool) -> bool:
        if failure.code in TEMPORARY_CODES or failure.status == 503:
            return retries < len(RETRY_DELAYS)
        if failure.code == INVALID_USER_CODE or failure.status == 401:
            return not refreshed
        return False

    async def _final_error(self, event: LLMEvent, failure: LLMProviderError) -> LLMEvent:
        if failure.code and failure.code.startswith("chatgpt_plan_"):
            return event
        if failure.code == USAGE_LIMIT_CODE:
            await service.pause_for_usage_limit(self.owner_user_id)
            return _plan_error(PlanUnavailableReason.USAGE_LIMIT, cause=failure)
        if failure.code in TEMPORARY_CODES or failure.status == 503:
            return _plan_error(PlanUnavailableReason.TEMPORARILY_UNAVAILABLE, cause=failure)
        if failure.code == NOT_ELIGIBLE_CODE:
            return _plan_error(PlanUnavailableReason.NOT_ELIGIBLE, cause=failure)
        if failure.code == INVALID_USER_CODE or failure.status == 401:
            return _plan_error(PlanUnavailableReason.SESSION_REJECTED, cause=failure)
        return event

    async def generate[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> LLMEvent[T]:
        last_event: LLMEvent[T] | None = None
        async for event in self.chat(messages=messages, tools=tools, response_model=response_model, **kwargs):
            if event.type == LLMEventType.ERROR:
                raise Exception(f"[CHAT ERROR: {event.content}]")
            if event.type == LLMEventType.COMPLETE:
                last_event = event
        if not last_event:
            raise Exception("No completion event received from LLM.")
        return last_event
