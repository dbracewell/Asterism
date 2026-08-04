from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from asterism.llm import LLMClient


class LLMModel(BaseModel):
    provider_id: str
    name: str

    def __eq__(self, other: object) -> bool:
        if isinstance(other, LLMModel):
            return (
                self.name == other.name
                and self.provider_id == other.provider_id
            )
        return False

    @property
    def key(self) -> str:
        return f"{self.provider_id}::{self.name}"

    async def get_client(
        self,
        session: AsyncSession | None = None,
    ) -> LLMClient:
        from asterism.db import get_async_db_session
        from asterism.llm import LLMClient
        from asterism.repositories import settings_repository

        async with get_async_db_session(session) as session:
            app_settings = await settings_repository.get_app_settings(
                session=session
            )
            provider = app_settings.get_provider(self.provider_id)
            if not provider:
                raise ValueError(
                    f"Provider with ID {self.provider_id} not found"
                )
            return LLMClient(
                api_key=provider.api_key,
                llm_host=provider.base_url,
                model_name=self.name,
            )


class LLMProviderModel(LLMModel):
    is_active: bool


class LLMProvider(BaseModel):
    id: str
    name: str
    base_url: str
    api_key: str
    models: list[LLMProviderModel]


class DraftModel(BaseModel):
    repo_id: str
    filename: str
