from __future__ import annotations

import uuid

from asterism.common import Component, ComponentType, LLMClientProtocol, NoArgs
from asterism.registries import component_registry


@component_registry.register()
class LLMClientProvider(Component[NoArgs]):
    component_type: ComponentType = ComponentType.LLMClientProvider
    singleton: bool = True
    name: str = ComponentType.LLMClientProvider.value
    parameters: type[NoArgs] = NoArgs

    def __init__(self, config: NoArgs) -> None:
        super().__init__(config)

    async def __call__(
        self,
        model_id: uuid.UUID,
    ) -> LLMClientProtocol:
        from asterism.llm import LLMClient
        from asterism.repositories import settings_repository

        model_info = await settings_repository.get_model_and_provider(
            model_id=model_id,
        )
        client = LLMClient(
            api_key=model_info.provider.api_key,
            llm_host=model_info.provider.base_url,
            model_name=model_info.name,
        )
        return client
