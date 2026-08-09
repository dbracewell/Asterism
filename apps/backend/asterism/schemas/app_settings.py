from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from .components import ComponentProviderParameters

if TYPE_CHECKING:
    from .provider import LLMProvider


class ApplicationSettingsModel(BaseModel):
    llm_providers: list[LLMProvider] = Field(default_factory=list)
    draft_model_id: uuid.UUID | None = None
    web_search_provider: ComponentProviderParameters | None = None
    image_search_provider: ComponentProviderParameters | None = None
