"""Providers and models: listing, editing, discovery merges, the draft model and model lookup.

API keys round-trip redacted: responses serialize :class:`SecretStr` to
``**********``, and writes that echo that sentinel keep the stored key.
Provider/model edits that could orphan the selected captioning model call
:func:`asterism.domains.settings.captioning_guard.get_captioning_selection_guard`
before commit.
"""

import uuid
from collections import Counter
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, noload, selectinload

from asterism.common.log import get_logger
from asterism.core.events import EventType, NoArgEvent, event_bus
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.llm.client import forget_openai_clients

from .captioning_guard import get_captioning_selection_guard
from .models import (
    ApplicationSettingsModel,
    LLMModel,
    ProviderModel,
)
from .provider_types import ProviderType
from .queries import is_global_model, is_global_provider, select_visible_models
from .schemas import (
    Llm,
    LlmDisplayInfo,
    LlmWithProvider,
    Provider,
    ProviderInfo,
    ProviderModelsPage,
    ProviderModelUpdate,
    ProviderSettings,
    ProviderSummary,
)
from .secrets import (
    REDACTED_SECRET,
)

logger = get_logger("Settings")


_REDACTED_API_KEY = REDACTED_SECRET


def llm_display_info(model: LLMModel) -> LlmDisplayInfo:
    """Flatten a model row (with its provider loaded) into the picker/list view."""
    return LlmDisplayInfo(
        id=model.id,
        name=model.name,
        display_name=model.display_name,
        provider_id=model.provider_id,
        provider_name=model.provider.name,
        provider_type=model.provider.provider_type,
        context_window=model.context_window,
        supports_vision=model.supports_vision,
        supports_tools=model.supports_tools,
        tools_source=model.tools_source,
        context_window_source=model.context_window_source,
        vision_source=model.vision_source,
        pricing=model.pricing,
    )


def _provider_api_key(provider: ProviderInfo, existing_api_key: str | None = None) -> str:
    """Unwrap a submitted API key without replacing an existing redacted key.

    Args:
        provider: The incoming provider payload; its ``api_key`` may be the
            redaction sentinel echoed back from a previous response.
        existing_api_key: The currently stored (decrypted) key, kept when the
            client did not submit a real replacement.

    Raises:
        BadDataException: When a brand-new provider echoes the redaction
            sentinel — there is no stored key to keep, so persisting the
            sentinel would store it as a literal credential.
    """
    api_key = provider.api_key.get_secret_value()
    if api_key == _REDACTED_API_KEY:
        if existing_api_key is None:
            raise BadDataException("A real API key is required for a new provider")
        return existing_api_key
    return api_key


async def _ensure_provider_unbound(provider_id: uuid.UUID, session: AsyncSession) -> None:
    """Refuse to delete a provider still referenced by any sub-agent definition."""
    bound = await session.scalar(
        select(AgentProfileModel.id)
        .join(
            LLMModel,
            LLMModel.id == AgentProfileModel.model_id,
        )
        .where(LLMModel.provider_id == provider_id, AgentProfileModel.sub_agent.is_(True))
        .limit(1),
    )
    if bound is not None:
        raise BadDataException("Rebind or delete sub-agents before deleting their model provider")


async def _delete_missing_providers(
    existing_ids: set[uuid.UUID],
    incoming_ids: set[uuid.UUID],
    session: AsyncSession,
) -> None:
    """Delete providers absent from the incoming list (after the binding check)."""
    for deleted_id in existing_ids.difference(incoming_ids):
        await _ensure_provider_unbound(deleted_id, session)
        await session.execute(delete(ProviderModel).where(ProviderModel.id == deleted_id))


async def get_provider_settings(
    session: AsyncSession | None = None,
) -> ProviderSettings:
    """Build the provider landing-page payload (summaries plus the draft model)."""
    async with get_async_db_session(session) as session:
        model_count = select(func.count(LLMModel.id)).where(LLMModel.provider_id == ProviderModel.id).scalar_subquery()
        active_model_count = (
            select(func.count(LLMModel.id))
            .where(LLMModel.provider_id == ProviderModel.id, LLMModel.is_active)
            .scalar_subquery()
        )
        providers_stmt = (
            select(
                ProviderModel,
                model_count.label("model_count"),
                active_model_count.label("active_model_count"),
            )
            .where(is_global_provider())
            .options(noload(ProviderModel.models))
        )
        providers = list((await session.execute(providers_stmt)).all())
        draft_model_id = await session.scalar(
            select(ApplicationSettingsModel.value).where(
                ApplicationSettingsModel.key == "draft_model_id",
            ),
        )

        draft_model = None
        parsed_draft_model_id: uuid.UUID | None = None
        if draft_model_id:
            try:
                parsed_draft_model_id = uuid.UUID(str(draft_model_id))
            except (TypeError, ValueError):
                # A hand-edited setting can hold a non-UUID string; treat it as
                # unset rather than failing the whole landing-page payload.
                logger.warning("Stored draft_model_id setting is not a valid UUID; ignoring it")
            draft_row = (
                await session.scalar(
                    select(LLMModel)
                    .where(LLMModel.id == parsed_draft_model_id, is_global_model())
                    .options(joinedload(LLMModel.provider)),
                )
                if parsed_draft_model_id is not None
                else None
            )
            if draft_row is not None:
                draft_model = llm_display_info(draft_row)

        return ProviderSettings(
            llm_providers=[
                ProviderSummary(
                    id=provider.id,
                    name=provider.name,
                    base_url=provider.base_url,
                    api_key=provider.api_key,
                    provider_type=provider.provider_type,
                    service=provider.service,
                    model_count=count,
                    active_model_count=active_count,
                )
                for provider, count, active_count in providers
            ],
            draft_model_id=parsed_draft_model_id,
            draft_model=draft_model,
        )


async def stored_draft_model_id(session: AsyncSession) -> uuid.UUID | None:
    """The selected draft model's id, or None when unset or not a UUID."""
    value = await session.scalar(
        select(ApplicationSettingsModel.value).where(ApplicationSettingsModel.key == "draft_model_id"),
    )
    try:
        return uuid.UUID(str(value)) if value else None
    except (TypeError, ValueError):
        return None


async def update_provider_settings(
    settings: ProviderSettings,
    session: AsyncSession | None = None,
) -> ProviderSettings:
    """Replace the full provider list.

    Providers absent from the payload are deleted (after a sub-agent binding
    check); present providers have their connection fields updated but their
    model lists are left untouched. The draft selection is cleared if its
    provider was removed and validated otherwise. Emits DRAFT_MODEL_UPDATED.
    """
    _reject_owned_provider_types(settings.llm_providers)
    _reject_duplicate_names(settings.llm_providers)
    async with get_async_db_session(session) as session, _provider_conflicts(session):
        existing_providers = {
            provider.id: provider
            for provider in (
                await session.scalars(
                    select(ProviderModel).where(is_global_provider()).options(noload(ProviderModel.models)),
                )
            ).all()
        }
        # Pooled clients for these providers are rebuilt from the saved settings (US-116.3).
        forget_openai_clients(provider.base_url for provider in existing_providers.values())
        incoming_ids = {provider.id for provider in settings.llm_providers}
        draft_model_id = settings.draft_model_id
        if draft_model_id is not None:
            draft_provider_id = await session.scalar(
                select(LLMModel.provider_id).where(LLMModel.id == draft_model_id, is_global_model()),
            )
            if draft_provider_id is not None and draft_provider_id not in incoming_ids:
                draft_model_id = None
        await _delete_missing_providers(set(existing_providers), incoming_ids, session)

        for provider in settings.llm_providers:
            existing = existing_providers.get(provider.id)
            if existing is None:
                session.add(
                    ProviderModel(
                        id=provider.id,
                        provider_type=provider.provider_type,
                        service=provider.service,
                        name=provider.name,
                        base_url=provider.base_url,
                        api_key=_provider_api_key(provider),
                    ),
                )
            else:
                existing.provider_type = provider.provider_type
                existing.service = provider.service
                existing.name = provider.name
                existing.base_url = provider.base_url
                existing.api_key = _provider_api_key(provider, existing.api_key)

        # A provider-settings replacement may remove a provider (and its
        # cascade-owned models).  The selected captioner is part of the global
        # processing policy, so reject that edit rather than leaving a stored
        # policy pointing at a missing or ineligible model.
        await get_captioning_selection_guard().validate(session=session)

        if draft_model_id is not None:
            draft_model = await session.scalar(
                select(LLMModel).where(
                    LLMModel.id == draft_model_id,
                    LLMModel.is_active,
                    is_global_model(),
                ),
            )
            if draft_model is None:
                raise BadDataException("draft_model_id must reference an active model")
        # Clearing the draft deletes its row; the value column is NOT NULL and
        # an absent row means "no draft selected".
        if draft_model_id is None:
            await session.execute(
                delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "draft_model_id")
            )
        else:
            stmt = (
                insert(ApplicationSettingsModel)
                .values({"key": "draft_model_id", "value": str(draft_model_id)})
                .on_conflict_do_update(
                    index_elements=["key"],
                    set_={"value": str(draft_model_id)},
                )
            )
            await session.execute(stmt)
        await session.commit()

    event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))
    return await get_provider_settings(session)


async def get_provider_models(
    provider_id: uuid.UUID,
    query: str = "",
    cursor: uuid.UUID | None = None,
    limit: int = 50,
    session: AsyncSession | None = None,
) -> ProviderModelsPage:
    """Keyset-paginated, case-insensitive search over one provider's models.

    Pages by ``(lower(name), id)``; ``cursor`` must be a model id from this
    provider and is validated before the page query runs.
    """
    async with get_async_db_session(session) as session:
        exists = await session.scalar(
            select(ProviderModel.id).where(ProviderModel.id == provider_id, is_global_provider()),
        )
        if exists is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")

        normalized_name = func.lower(LLMModel.name)
        base_filters = [LLMModel.provider_id == provider_id]
        if query.strip():
            escaped_query = query.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            base_filters.append(normalized_name.like(f"%{escaped_query}%", escape="\\"))

        filters = [*base_filters]

        if cursor is not None:
            cursor_model = await session.scalar(
                select(LLMModel).where(
                    LLMModel.id == cursor,
                    LLMModel.provider_id == provider_id,
                ),
            )
            if cursor_model is None:
                raise BadDataException("cursor must reference a model in this provider")
            cursor_name = cursor_model.name.lower()
            filters.append(
                or_(
                    normalized_name > cursor_name,
                    and_(normalized_name == cursor_name, LLMModel.id > cursor),
                ),
            )

        rows = list(
            (
                await session.scalars(
                    select(LLMModel).where(*filters).order_by(normalized_name, LLMModel.id).limit(limit + 1),
                )
            ).all(),
        )
        page_models = rows[:limit]
        total = await session.scalar(select(func.count(LLMModel.id)).where(*base_filters))
        return ProviderModelsPage(
            models=[Llm.model_validate(model) for model in page_models],
            next_cursor=str(rows[limit].id) if len(rows) > limit else None,
            total=total or 0,
        )


async def update_provider_model(
    provider_id: uuid.UUID,
    model_id: uuid.UUID,
    update: ProviderModelUpdate,
    session: AsyncSession | None = None,
) -> Llm:
    """Replace one model's flags/capabilities; keeps the draft selection valid.

    If the edit deactivates the current draft model, the draft moves to the
    first active model (by name) or is cleared. Emits DRAFT_MODEL_UPDATED.
    """
    async with get_async_db_session(session) as session:
        model = await session.scalar(
            select(LLMModel).where(
                LLMModel.id == model_id,
                LLMModel.provider_id == provider_id,
                is_global_model(),
            ),
        )
        if model is None:
            raise NotFoundException(f"Model id {model_id} not found in provider")

        model.is_active = update.is_active
        model.context_window = update.context_window
        model.tools_source = update.tools_source
        model.supports_tools = update.supports_tools
        model.supports_vision = update.supports_vision
        model.context_window_source = update.context_window_source
        model.vision_source = update.vision_source
        model.pricing = update.pricing
        await session.flush()

        await get_captioning_selection_guard().validate(session=session)

        draft_model_id = await session.scalar(
            select(ApplicationSettingsModel.value).where(
                ApplicationSettingsModel.key == "draft_model_id",
            ),
        )
        if not model.is_active and str(model.id) == str(draft_model_id):
            replacement = await session.scalar(
                select(LLMModel.id)
                .where(LLMModel.is_active, is_global_model())
                .order_by(func.lower(LLMModel.name), LLMModel.id)
                .limit(1),
            )
            if replacement is None:
                # No active model remains; clear the draft by deleting its row.
                await session.execute(
                    delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "draft_model_id")
                )
            else:
                await session.execute(
                    insert(ApplicationSettingsModel)
                    .values({"key": "draft_model_id", "value": str(replacement)})
                    .on_conflict_do_update(
                        index_elements=["key"],
                        set_={"value": str(replacement)},
                    ),
                )
        await session.commit()
        result = Llm.model_validate(model)

    event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))
    return result


async def get_provider_for_discovery(
    provider_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> Provider:
    """Load a provider with its models for a discovery run."""
    async with get_async_db_session(session) as session:
        provider = await session.scalar(
            select(ProviderModel)
            .where(ProviderModel.id == provider_id, is_global_provider())
            .options(selectinload(ProviderModel.models)),
        )
        if provider is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")
        return Provider.model_validate(provider)


async def replace_provider_models(
    provider_id: uuid.UUID,
    models: list[Llm],
    session: AsyncSession | None = None,
) -> ProviderSummary:
    """Merge discovered models into a provider, deleting models no longer listed.

    Raises ConflictException if an agent or project still references a removed model.
    """
    async with get_async_db_session(session) as session:
        provider = await session.scalar(
            select(ProviderModel)
            .where(ProviderModel.id == provider_id, is_global_provider())
            .options(selectinload(ProviderModel.models)),
        )
        if provider is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")
        provider.models = _merge_models(models, provider.models)

        await get_captioning_selection_guard().validate(session=session)
        async with _provider_conflicts(session, "Cannot remove model currently in use by an agent or project"):
            await session.commit()

    settings = await get_provider_settings(session)
    summary = next((item for item in settings.llm_providers if item.id == provider_id), None)
    if summary is None:
        raise NotFoundException(f"Provider id {provider_id} not found in database")
    return summary


async def get_captioning_models(
    session: AsyncSession | None = None,
) -> list[LlmDisplayInfo]:
    """List active vision-capable models eligible for image captioning."""
    async with get_async_db_session(session) as session:
        rows = list(
            (
                await session.scalars(
                    # ``supports_vision=True`` already implies a non-UNKNOWN
                    # vision_source (schema normalization), so no source filter.
                    select(LLMModel)
                    .where(
                        LLMModel.is_active.is_(True),
                        LLMModel.supports_vision.is_(True),
                        is_global_model(),
                    )
                    .options(joinedload(LLMModel.provider))
                    .order_by(func.lower(LLMModel.name), LLMModel.id),
                )
            ).all(),
        )
        return [llm_display_info(model) for model in rows]


async def get_draft_model(
    session: AsyncSession | None = None,
) -> LlmWithProvider:
    """Resolve the configured draft model with its provider; 404 if unset or inactive."""
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel.value).where(ApplicationSettingsModel.key == "draft_model_id")

        value = await session.scalar(stmt)
        if not value:
            raise NotFoundException("Draft model not set in application settings")

        try:
            draft_model_id = uuid.UUID(str(value))
        except (TypeError, ValueError) as exc:
            # A hand-edited setting can hold a non-UUID string.
            raise BadDataException("Stored draft_model_id setting is not a valid UUID") from exc

        stmt = (
            select(LLMModel)
            .options(joinedload(LLMModel.provider))
            .where(
                LLMModel.id == draft_model_id,
                LLMModel.is_active,
                is_global_model(),
            )
        )

        result = await session.scalar(stmt)
        if not result:
            raise NotFoundException(f"Model id {draft_model_id} not found in database")

        return LlmWithProvider.model_validate(result)


async def get_all_providers(session: AsyncSession) -> list[ProviderModel]:
    """Load all admin-managed providers eagerly including their models."""
    async with get_async_db_session(session) as session:
        stmt = (
            select(ProviderModel)
            .where(is_global_provider())
            .options(
                selectinload(ProviderModel.models),
            )
        )
        result = await session.scalars(stmt)
        return list(result.all())


async def get_user_models(
    user_id: str,
    session: AsyncSession | None = None,
) -> list[LlmDisplayInfo]:
    """List the models ``user_id`` can use now: active global models plus the
    user's own available ChatGPT plan models."""
    from asterism.domains.chatgpt.availability import ModelAvailability

    async with get_async_db_session(session) as session:
        availability = await ModelAvailability.load(user_id, session)
        rows = await session.scalars(select_visible_models(user_id))
        return [llm_display_info(m) for m in rows.all() if availability.reason(m) is None]


async def get_model_and_provider(
    model_id: uuid.UUID,
    user_id: str | None = None,
    session: AsyncSession | None = None,
) -> LlmWithProvider:
    """Fetch an active model with its provider for execution.

    With ``user_id``, the model must be visible to that user (global or the
    user's own plan model); without it, only global models qualify. Plan
    availability is enforced when a request fetches the owner's token.
    """
    async with get_async_db_session(session) as session:
        stmt = (
            select_visible_models(user_id)
            if user_id is not None
            else select(LLMModel).where(is_global_model()).options(joinedload(LLMModel.provider))
        ).where(LLMModel.id == model_id, LLMModel.is_active)
        result = await session.scalar(stmt)
        if not result:
            raise NotFoundException(f"Model id {model_id} not found in database")

        return LlmWithProvider.model_validate(result)


def _reject_owned_provider_types(providers: Sequence[ProviderInfo]) -> None:
    """Admins cannot create or convert providers into a user's ChatGPT plan."""
    if any(provider.provider_type == ProviderType.CHATGPT for provider in providers):
        raise BadDataException("ChatGPT plan providers are connected by users, not configured by admins")


def _reject_duplicate_names(providers: Sequence[ProviderInfo]) -> None:
    """Admin providers need distinct names (``uq_providers_global_name``); say which one repeats."""
    repeated = sorted(name for name, count in Counter(provider.name for provider in providers).items() if count > 1)
    if repeated:
        raise ConflictException(f"Two providers are named {repeated[0]!r}; give each provider a different name")


PROVIDER_CONFLICT = (
    "These provider changes conflict with saved settings. Each provider needs its own name, and a model "
    "still used by an agent or project can't be removed. To swap two names, rename one and save first."
)


@asynccontextmanager
async def _provider_conflicts(session: AsyncSession, message: str = PROVIDER_CONFLICT) -> AsyncIterator[None]:
    """Turn a database constraint failure during a provider write into a 409 that says what to change."""
    try:
        yield
    except IntegrityError as error:
        await session.rollback()
        raise ConflictException(message) from error


async def bulk_upsert_providers(
    update: list[Provider],
    session: AsyncSession,
):
    """Sync the provider tables with a full provider list (the caller owns the transaction).

    Updates/creates providers, merges each provider's models by name, and
    deletes providers absent from the payload after the sub-agent binding check.
    """
    _reject_owned_provider_types(update)
    _reject_duplicate_names(update)
    async with _provider_conflicts(session):
        await _sync_providers(update, session)


async def _sync_providers(update: list[Provider], session: AsyncSession) -> None:
    current_providers = await get_all_providers(session=session)
    processed_providers = set()
    existing_providers = {p.id: p for p in current_providers}
    # Pooled clients for these providers are rebuilt from the saved settings (US-116.3).
    forget_openai_clients(provider.base_url for provider in current_providers)

    for provider in update:
        existing_provider = existing_providers.get(provider.id, None)

        if existing_provider:
            processed_providers.add(provider.id)
            existing_provider.provider_type = provider.provider_type
            existing_provider.service = provider.service
            existing_provider.base_url = provider.base_url
            existing_provider.api_key = _provider_api_key(
                provider,
                existing_provider.api_key,
            )
            existing_provider.name = provider.name
            existing_provider.models = _merge_models(
                provider.models,
                existing_provider.models,
            )
            await session.flush()
        else:
            processed_providers.add(provider.id)
            new_provider = ProviderModel(
                id=provider.id,
                provider_type=provider.provider_type,
                service=provider.service,
                name=provider.name,
                base_url=provider.base_url,
                api_key=_provider_api_key(provider),
                models=[
                    LLMModel(
                        id=m.id,
                        name=m.name,
                        is_active=m.is_active,
                        context_window=m.context_window,
                        supports_vision=m.supports_vision,
                        supports_tools=m.supports_tools,
                        tools_source=m.tools_source,
                        context_window_source=m.context_window_source,
                        vision_source=m.vision_source,
                        pricing=m.pricing,
                    )
                    for m in provider.models
                ],
            )
            session.add(new_provider)
            await session.flush()

    await _delete_missing_providers(set(existing_providers), processed_providers, session)

    await get_captioning_selection_guard().validate(session=session)


def _merge_models(
    new_models: list[Llm],
    existing: list[LLMModel],
):
    """Merge incoming model data into existing ORM rows keyed by name.

    Existing rows keep their identity (id) and price metadata, which is edited
    only per model (``update_provider_model``); models absent from ``new_models``
    are dropped from the returned list so the delete-orphan cascade removes them.
    """
    existing_models_by_name = {m.name: m for m in existing}
    synced_models: list[LLMModel] = []
    for m_data in new_models:
        if m_data.name in existing_models_by_name:
            existing_model = existing_models_by_name[m_data.name]
            existing_model.is_active = m_data.is_active
            existing_model.context_window = m_data.context_window
            existing_model.tools_source = m_data.tools_source
            existing_model.supports_tools = m_data.supports_tools
            existing_model.supports_vision = m_data.supports_vision
            existing_model.context_window_source = m_data.context_window_source
            existing_model.vision_source = m_data.vision_source
            synced_models.append(existing_model)
        else:
            new_model = LLMModel(
                id=m_data.id,
                name=m_data.name,
                is_active=m_data.is_active,
                context_window=m_data.context_window,
                supports_vision=m_data.supports_vision,
                supports_tools=m_data.supports_tools,
                tools_source=m_data.tools_source,
                context_window_source=m_data.context_window_source,
                vision_source=m_data.vision_source,
                pricing=m_data.pricing,
            )
            synced_models.append(new_model)
    return synced_models
