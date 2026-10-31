"""Sync one user's ChatGPT plan models into their own CHATGPT provider.

Models come from ``GET /v1/models`` with the user's access token; only entries
with ``visibility == "list"`` count. Each listed ``slug`` becomes (or
reactivates) a model row under the user's provider, with the server's
``display_name``. Models no longer listed are deactivated, never deleted, so
chats and sub-agents bound to them stay bound and show as unavailable.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from asterism.common.log import get_logger
from asterism.domains.settings.models import LLMModel, ProviderModel
from asterism.domains.settings.provider_types import OPENAI_BASE_URL, ModelCapabilitySource, ProviderType

from .oauth import RESOURCE

logger = get_logger("ChatGPTPlanModels")

MODELS_URL = f"{RESOURCE}/models"
PROVIDER_NAME = "ChatGPT"
_HTTP_TIMEOUT_SECONDS = 15.0

_api_http: httpx.AsyncClient | None = None


def api_http() -> httpx.AsyncClient:
    """Process-wide HTTP client for the OpenAI API (tests inject a double)."""
    global _api_http
    if _api_http is None:
        _api_http = httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=False)
    return _api_http


async def close_api_http() -> None:
    global _api_http
    if _api_http is not None:
        await _api_http.aclose()
        _api_http = None


class PlanModelsUnavailable(Exception):
    """The model list could not be fetched or parsed."""


@dataclass(frozen=True)
class PlanModel:
    slug: str
    display_name: str | None


async def fetch_plan_models(access_token: str) -> list[PlanModel]:
    """Return the account's listed models in server order."""
    try:
        response = await api_http().get(MODELS_URL, headers={"Authorization": f"Bearer {access_token}"})
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise PlanModelsUnavailable("ChatGPT plan models could not be loaded") from error
    entries = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise PlanModelsUnavailable("ChatGPT plan model list is malformed")
    models: list[PlanModel] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("visibility") != "list":
            continue
        slug = entry.get("slug")
        if not isinstance(slug, str) or not slug.strip() or slug in seen:
            continue
        display_name = entry.get("display_name")
        seen.add(slug)
        models.append(
            PlanModel(slug=slug, display_name=display_name if isinstance(display_name, str) and display_name else None)
        )
    return models


async def owned_provider(user_id: str, session: AsyncSession) -> ProviderModel | None:
    return await session.scalar(
        select(ProviderModel)
        .where(ProviderModel.owner_user_id == user_id, ProviderModel.provider_type == ProviderType.CHATGPT)
        .options(selectinload(ProviderModel.models)),
    )


async def store_plan_models(user_id: str, listed: list[PlanModel], session: AsyncSession) -> int:
    """Upsert ``listed`` under the user's provider; returns the active count."""
    provider = await owned_provider(user_id, session)
    if provider is None:
        provider = ProviderModel(
            name=PROVIDER_NAME,
            base_url=OPENAI_BASE_URL,
            api_key="",
            provider_type=ProviderType.CHATGPT,
            owner_user_id=user_id,
            models=[],
        )
        session.add(provider)
    existing = {model.name: model for model in provider.models}
    for item in listed:
        model = existing.get(item.slug)
        if model is None:
            # The plan route accepts function tools for every model; vision and
            # context size are not reported, so they stay unknown.
            provider.models.append(
                LLMModel(
                    name=item.slug,
                    display_name=item.display_name,
                    is_active=True,
                    supports_tools=True,
                    tools_source=ModelCapabilitySource.PROVIDER,
                ),
            )
        else:
            model.is_active = True
            model.display_name = item.display_name
    listed_slugs = {item.slug for item in listed}
    for name, model in existing.items():
        if name not in listed_slugs:
            model.is_active = False
    await session.commit()
    logger.info("ChatGPT plan models synced user=%s listed=%d", user_id, len(listed))
    return len(listed)
