"""Image generators are components (ADR-0064).

A generator is an ``ImageGenerator`` component: a named adapter with a
parameter model, selected and configured through the ``image_generator_provider``
setting like the search providers. The domain around it owns the policy,
prompt check, job queue, audit and storage. ComfyUI and the local diffusers
generator register in ``generators.py``; tests register a fake.
"""

import abc
from collections.abc import Awaitable, Callable
from typing import ClassVar

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.components.schemas import Component, ComponentType

from .schemas import ImageProgress, ImageProviderStatus, ImageRequest, ProviderResult

ProgressCallback = Callable[[ImageProgress], Awaitable[None]]
SETTING_KEY = "image_generator_provider"
NO_PROVIDER = "none"


class ImageGenerationError(Exception):
    """A provider failure whose message is safe to show the user."""


class ImageGeneratorComponent[T: BaseModel](Component[T], abc.ABC):
    component_type: ClassVar[ComponentType] = ComponentType.ImageGenerator

    @abc.abstractmethod
    async def status(self) -> ImageProviderStatus:
        """Ready to generate, or why not. Called on every availability check, so keep it cheap."""

    @abc.abstractmethod
    async def __call__(self, request: ImageRequest, progress: ProgressCallback) -> ProviderResult: ...


async def selected_name(session: AsyncSession) -> str:
    from asterism.domains.settings.models import ApplicationSettingsModel

    row = await session.get(ApplicationSettingsModel, SETTING_KEY)
    name = row.value.get("name") if row is not None and isinstance(row.value, dict) else None
    return str(name) if name else NO_PROVIDER


async def load_generator(session: AsyncSession) -> ImageGeneratorComponent | None:
    """The configured generator, or None when none is selected or it isn't installed."""
    from asterism.domains.components.registry import component_registry
    from asterism.domains.settings.models import ApplicationSettingsModel
    from asterism.domains.settings.secrets import decrypt_component_provider_dict

    row = await session.get(ApplicationSettingsModel, SETTING_KEY)
    stored = decrypt_component_provider_dict(row.value) if row is not None else None
    if not isinstance(stored, dict) or not stored.get("name"):
        return None
    if component_registry.find(ComponentType.ImageGenerator, str(stored["name"])) is None:
        return None
    try:
        component = await component_registry.get_component(
            ComponentType.ImageGenerator, str(stored["name"]), stored.get("parameters") or {}
        )
    except ValueError:
        # Parameters that no longer validate (a direct write or an older shape).
        return None
    return component if isinstance(component, ImageGeneratorComponent) else None
