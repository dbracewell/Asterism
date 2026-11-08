"""Admin context-compaction policy (ADR-0060), stored under one application setting."""

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException

from .models import ApplicationSettingsModel, LLMModel
from .queries import is_global_model
from .schemas import CompactionSettings, LlmDisplayInfo
from .service import llm_display_info, upsert_app_setting

COMPACTION_SETTING = "compaction"
logger = get_logger(__name__)


class CompactionPolicy(BaseModel):
    """The policy and the models an admin may choose as the summarizer."""

    settings: CompactionSettings
    models: list[LlmDisplayInfo] = Field(default_factory=list)


async def read_compaction_settings(session: AsyncSession) -> CompactionSettings:
    """Missing or malformed values fall back to the defaults."""
    row = await session.get(ApplicationSettingsModel, COMPACTION_SETTING)
    if row is None or not isinstance(row.value, dict):
        return CompactionSettings()
    try:
        return CompactionSettings.model_validate(row.value)
    except ValidationError:
        logger.warning("Ignoring malformed compaction settings")
        return CompactionSettings()


async def _summarizer_models(session: AsyncSession) -> list[LlmDisplayInfo]:
    rows = await session.scalars(
        select(LLMModel)
        .where(LLMModel.is_active.is_(True), is_global_model())
        .options(joinedload(LLMModel.provider))
        .order_by(func.lower(LLMModel.name), LLMModel.id)
    )
    return [llm_display_info(model) for model in rows]


async def read_compaction_policy(session: AsyncSession) -> CompactionPolicy:
    return CompactionPolicy(settings=await read_compaction_settings(session), models=await _summarizer_models(session))


async def write_compaction_settings(payload: CompactionSettings, session: AsyncSession) -> CompactionPolicy:
    """Save the policy; a summarizer must be an active admin-managed model."""
    if payload.model_id is not None:
        model = await session.scalar(
            select(LLMModel.id).where(LLMModel.id == payload.model_id, LLMModel.is_active.is_(True), is_global_model())
        )
        if model is None:
            raise BadDataException("Choose an active model from an admin-managed provider")
    await upsert_app_setting(COMPACTION_SETTING, payload.model_dump(mode="json"), session=session)
    return await read_compaction_policy(session)
