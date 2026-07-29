from pydantic import BaseModel, Field

from asterism import config
from asterism.common.llm_models import (
    DraftModel,
    LLMModel,
    LLMProvider,
)


class ApplicationSettingsModel(BaseModel):
    llm_providers: list[LLMProvider] = Field(default_factory=list)
    default_model: LLMModel = Field(
        default_factory=lambda: LLMModel(provider_id="", name="")
    )
    draft_model: DraftModel = Field(
        default_factory=lambda: DraftModel(
            repo_id=config.DEFAULT_DRAT_MODEL_REPO_ID,
            filename=config.DEFAULT_DRAFT_MODEL_FILENAME,
        )
    )

    def get_provider(self, provider_id: str):
        for provider in self.llm_providers:
            if provider_id == provider.id:
                return provider
        raise ValueError("No Provider")

    def get_default_model_and_provider(self) -> tuple[str, LLMProvider]:
        name = self.default_model.name
        if name:
            provider = next(
                (
                    obj
                    for obj in self.llm_providers
                    if obj.id == self.default_model.provider_id
                ),
                None,
            )
            if provider is None:
                raise RuntimeError("No Provider")
            return name, provider

        for provider in self.llm_providers:
            model = next(
                (obj for obj in provider.models if obj.is_active), None
            )
            if model:
                return model.name, provider

        raise RuntimeError("No Provider")
