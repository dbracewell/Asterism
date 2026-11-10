"""The image provider interface and the registry of available providers (ADR-0064).

ComfyUI (US-76.3) and local diffusers (US-76.2) register here; tests register
a fake. Only the policy's active provider runs.
"""

from collections.abc import Awaitable, Callable
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import ImageProgress, ImageProviderName, ImageProviderStatus, ImageRequest, ProviderResult

ProgressCallback = Callable[[ImageProgress], Awaitable[None]]


class ImageGenerationError(Exception):
    """A provider failure whose message is safe to show the user."""


class ImageProvider(Protocol):
    name: ImageProviderName

    async def status(self) -> ImageProviderStatus: ...

    async def generate(self, request: ImageRequest, progress: ProgressCallback) -> ProviderResult: ...


ProviderFactory = Callable[[AsyncSession], Awaitable[ImageProvider]]
_FACTORIES: dict[str, ProviderFactory] = {}


def register_provider(name: ImageProviderName, factory: ProviderFactory) -> None:
    _FACTORIES[name] = factory


def unregister_provider(name: ImageProviderName) -> None:
    _FACTORIES.pop(name, None)


async def load_provider(name: ImageProviderName, session: AsyncSession) -> ImageProvider | None:
    """The configured provider, or None when it's "none" or not installed."""
    factory = _FACTORIES.get(name)
    return None if name == "none" or factory is None else await factory(session)
