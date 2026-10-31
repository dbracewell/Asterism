"""Whether a model can serve one user now, including ChatGPT plan state.

A ChatGPT plan model is usable only by its owner, only while it is active
(still listed by the account), the admin policy is enabled and the owner's
connection has plan usage. Unavailable models keep every binding and are
reported with a reason; nothing is ever retargeted to another model.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.queries import select_visible_models

from . import policy
from .models import ChatGPTConnectionModel, ChatGPTConnectionStatus


class PlanUnavailableReason(StrEnum):
    POLICY_DISABLED = "policy_disabled"
    NOT_CONNECTED = "not_connected"
    PLAN_USAGE_DISABLED = "plan_usage_disabled"
    REAUTHORIZATION_REQUIRED = "reauthorization_required"
    TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"
    USAGE_LIMIT = "usage_limit"
    NOT_ELIGIBLE = "not_eligible"
    SESSION_REJECTED = "session_rejected"


PLAN_UNAVAILABLE_MESSAGES = {
    PlanUnavailableReason.POLICY_DISABLED: "ChatGPT plans are turned off by your administrator",
    PlanUnavailableReason.NOT_CONNECTED: "Connect ChatGPT in User Settings to use this model",
    PlanUnavailableReason.PLAN_USAGE_DISABLED: (
        "ChatGPT did not allow plan usage; continue with ChatGPT in User Settings"
    ),
    PlanUnavailableReason.REAUTHORIZATION_REQUIRED: "Sign in to ChatGPT again in User Settings",
    PlanUnavailableReason.TEMPORARILY_UNAVAILABLE: "ChatGPT plan usage is temporarily unavailable; try again later",
    PlanUnavailableReason.USAGE_LIMIT: (
        "Usage limit reached. Review your plan or this app's limit in ChatGPT settings."
    ),
    PlanUnavailableReason.NOT_ELIGIBLE: "ChatGPT plan usage is not available for your account or workspace",
    PlanUnavailableReason.SESSION_REJECTED: "ChatGPT did not accept this session; try again later",
}


async def plan_status(user_id: str, session: AsyncSession) -> PlanUnavailableReason | None:
    """``None`` when ``user_id``'s plan can serve requests, else why not."""
    if not (await policy.read_policy(session)).enabled:
        return PlanUnavailableReason.POLICY_DISABLED
    connection = await session.get(ChatGPTConnectionModel, user_id)
    if connection is None or connection.status == ChatGPTConnectionStatus.DISCONNECTED:
        return PlanUnavailableReason.NOT_CONNECTED
    if connection.status == ChatGPTConnectionStatus.REAUTHORIZATION_REQUIRED:
        return PlanUnavailableReason.REAUTHORIZATION_REQUIRED
    if connection.status == ChatGPTConnectionStatus.PLAN_USAGE_DISABLED:
        return PlanUnavailableReason.PLAN_USAGE_DISABLED
    # Paused after a usage limit until the user explicitly tries again; no
    # reset time is inferred because an app-specific limit may apply.
    if connection.usage_paused_at is not None:
        return PlanUnavailableReason.USAGE_LIMIT
    return None


@dataclass(frozen=True)
class ModelAvailability:
    """Availability of models for one user, with the plan state read once."""

    user_id: str
    plan: PlanUnavailableReason | None

    @classmethod
    async def load(cls, user_id: str, session: AsyncSession) -> ModelAvailability:
        return cls(user_id=user_id, plan=await plan_status(user_id, session))

    def code(self, model: LLMModel) -> str | None:
        """Stable ``chatgpt_plan_<reason>`` code for an unavailable plan model."""
        if model.provider.provider_type != ProviderType.CHATGPT or self.reason(model) is None:
            return None
        if model.provider.owner_user_id != self.user_id or not model.is_active or self.plan is None:
            return None
        return f"chatgpt_plan_{self.plan.value}"

    def reason(self, model: LLMModel) -> str | None:
        """``None`` when usable; otherwise a user-facing reason. ``model.provider`` must be loaded."""
        provider = model.provider
        if provider.owner_user_id is not None and provider.owner_user_id != self.user_id:
            return "Model is unavailable"
        if provider.provider_type == ProviderType.CHATGPT:
            if not model.is_active:
                return "Model is no longer in your ChatGPT plan; choose another model"
            return PLAN_UNAVAILABLE_MESSAGES[self.plan] if self.plan else None
        return None if model.is_active else "Model disabled; choose another model"


async def available_user_model(user_id: str, model_id: uuid.UUID, session: AsyncSession) -> LLMModel | None:
    """The model when ``user_id`` may use it now, else ``None``."""
    model = await session.scalar(select_visible_models(user_id).where(LLMModel.id == model_id))
    if model is None or (await ModelAvailability.load(user_id, session)).reason(model) is not None:
        return None
    return model
