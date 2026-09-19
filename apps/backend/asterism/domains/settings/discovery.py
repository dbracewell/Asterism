from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Protocol, cast

import httpx
from openai import (
    APIConnectionError,
    APIResponseValidationError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
)
from pydantic import BaseModel, Field, SecretStr, model_validator

from asterism.common.log import get_logger

from .model_catalog import OPENAI_MODEL_CATALOG_VERSION, get_openai_capabilities
from .provider_types import (
    OPENAI_BASE_URL,
    ModelCapabilitySource,
    ProviderType,
    normalize_provider_base_url,
)
from .schemas import Llm

logger = get_logger("ProviderDiscovery")

MAX_DISCOVERY_RESPONSE_BYTES = 2 * 1024 * 1024
DISCOVERY_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


class ProviderDiscoveryRequest(BaseModel):
    provider_type: ProviderType
    base_url: str = ""
    api_key: SecretStr = Field(
        min_length=1, json_schema_extra={"writeOnly": True}
    )
    provider_id: uuid.UUID
    existing_models: list[Llm] = Field(default_factory=list)
    draft_model_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def normalize_base_url(self) -> "ProviderDiscoveryRequest":
        self.base_url = normalize_provider_base_url(
            self.provider_type, self.base_url
        )
        return self


class ProviderDiscoveryResponse(BaseModel):
    models: list[Llm]
    catalog_version: str | None = None
    warnings: list[str] = Field(default_factory=list)


class ProviderDiscoveryError(Exception):
    """A safe, categorized error suitable for an admin API response."""

    def __init__(self, status_code: int, category: str, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.category = category
        self.detail = detail


class ProviderDiscovery(Protocol):
    async def discover(
        self,
        request: ProviderDiscoveryRequest,
    ) -> ProviderDiscoveryResponse: ...


class _DiscoveryResponseTooLarge(Exception):
    pass


class _SizeLimitedStream(httpx.AsyncByteStream):
    def __init__(self, stream: httpx.AsyncByteStream) -> None:
        self._stream = stream
        self._size = 0

    async def __aiter__(self):
        async for chunk in self._stream:
            self._size += len(chunk)
            if self._size > MAX_DISCOVERY_RESPONSE_BYTES:
                raise _DiscoveryResponseTooLarge
            yield chunk

    async def aclose(self) -> None:
        await self._stream.aclose()


async def _limit_response_size(response: httpx.Response) -> None:
    content_length = response.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_DISCOVERY_RESPONSE_BYTES:
                raise _DiscoveryResponseTooLarge
        except ValueError:
            pass
    response.stream = _SizeLimitedStream(
        cast(httpx.AsyncByteStream, response.stream)
    )


class OpenAIProviderDiscovery:
    """Discover both first-party and compatible models through the OpenAI SDK."""

    def __init__(
        self,
        http_client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self._http_client_factory = http_client_factory or (
            lambda: httpx.AsyncClient(
                timeout=DISCOVERY_TIMEOUT,
                follow_redirects=False,
                event_hooks={"response": [_limit_response_size]},
            )
        )

    async def discover(
        self,
        request: ProviderDiscoveryRequest,
    ) -> ProviderDiscoveryResponse:
        base_url = normalize_provider_base_url(
            request.provider_type,
            request.base_url,
        )
        if request.provider_type == ProviderType.OPENAI:
            # Do not permit request data to influence the first-party origin.
            base_url = OPENAI_BASE_URL

        try:
            raw_models = await self._fetch_models(base_url, request.api_key)
        except ProviderDiscoveryError as exc:
            logger.warning(
                "Provider discovery failed",
                extra={
                    "provider_type": request.provider_type.value,
                    "error_category": exc.category,
                    "upstream_status": exc.status_code,
                },
            )
            raise
        warnings: list[str] = []
        discovered: list[Llm] = []
        seen_ids: set[str] = set()

        for raw_model in raw_models:
            model_id = raw_model.get("id")
            if not isinstance(model_id, str) or not model_id.strip():
                raise ProviderDiscoveryError(
                    502,
                    "malformed_response",
                    "Provider returned a model entry without a valid string id.",  # noqa: E501
                )
            model_id = model_id.strip()
            if model_id in seen_ids:
                continue
            seen_ids.add(model_id)

            if request.provider_type == ProviderType.OPENAI:
                capabilities = get_openai_capabilities(model_id)
                context_window = (
                    capabilities.context_window
                    if capabilities is not None
                    else None
                )
                supports_vision = (
                    capabilities.supports_vision
                    if capabilities is not None
                    else None
                )
                context_source = (
                    ModelCapabilitySource.CATALOG
                    if context_window is not None
                    else ModelCapabilitySource.UNKNOWN
                )
                vision_source = (
                    ModelCapabilitySource.CATALOG
                    if supports_vision is not None
                    else ModelCapabilitySource.UNKNOWN
                )
            else:
                context_window, context_conflict = _extract_context_window(
                    raw_model
                )
                supports_vision, vision_conflict = _extract_vision(raw_model)
                context_source = (
                    ModelCapabilitySource.PROVIDER
                    if context_window is not None
                    else ModelCapabilitySource.UNKNOWN
                )
                vision_source = (
                    ModelCapabilitySource.PROVIDER
                    if supports_vision is not None
                    else ModelCapabilitySource.UNKNOWN
                )
                if context_conflict:
                    warnings.append(
                        f"{model_id}: conflicting context-window metadata; "
                        "left unknown."
                    )
                if vision_conflict:
                    warnings.append(
                        f"{model_id}: conflicting vision metadata; left unknown."
                    )

            if context_window is None and not any(
                warning.startswith(f"{model_id}: conflicting context")
                for warning in warnings
            ):
                warnings.append(f"{model_id}: context window is unknown.")
            if supports_vision is None and not any(
                warning.startswith(f"{model_id}: conflicting vision")
                for warning in warnings
            ):
                warnings.append(f"{model_id}: vision support is unknown.")

            discovered.append(
                Llm(
                    id=uuid.uuid4(),
                    provider_id=request.provider_id,
                    name=model_id,
                    is_active=True,
                    context_window=context_window,
                    supports_vision=supports_vision,
                    context_window_source=context_source,
                    vision_source=vision_source,
                )
            )

        merged = merge_discovered_models(
            request.existing_models,
            discovered,
            draft_model_id=request.draft_model_id,
        )
        catalog_version = (
            OPENAI_MODEL_CATALOG_VERSION
            if request.provider_type == ProviderType.OPENAI
            else None
        )
        logger.info(
            "Provider discovery succeeded",
            extra={
                "provider_type": request.provider_type.value,
                "model_count": len(merged),
                "warning_count": len(warnings),
            },
        )
        return ProviderDiscoveryResponse(
            models=merged,
            catalog_version=catalog_version,
            warnings=warnings,
        )

    async def _fetch_models(
        self,
        base_url: str,
        api_key: SecretStr,
    ) -> list[dict[str, object]]:
        http_client = self._http_client_factory()
        client = AsyncOpenAI(
            api_key=api_key.get_secret_value(),
            base_url=base_url,
            timeout=DISCOVERY_TIMEOUT,
            max_retries=0,
            http_client=http_client,
        )
        try:
            page = await client.models.list()
            models = [model.model_dump() for model in page.data]
        except AuthenticationError as exc:
            raise ProviderDiscoveryError(
                502,
                "authentication_failed",
                "Provider rejected the supplied credentials.",
            ) from exc
        except APITimeoutError as exc:
            raise ProviderDiscoveryError(
                504,
                "timeout",
                "Provider model discovery timed out.",
            ) from exc
        except APIStatusError as exc:
            if 300 <= exc.status_code < 400:
                raise ProviderDiscoveryError(
                    502,
                    "redirect_blocked",
                    "Provider discovery redirect was blocked to protect credentials.",
                ) from exc
            raise ProviderDiscoveryError(
                502,
                "provider_error",
                f"Provider model discovery failed with HTTP {exc.status_code}.",
            ) from exc
        except (APIResponseValidationError, AttributeError, TypeError) as exc:
            raise ProviderDiscoveryError(
                502,
                "malformed_response",
                "Provider returned malformed model data.",
            ) from exc
        except APIConnectionError as exc:
            if _has_cause(exc, _DiscoveryResponseTooLarge):
                raise ProviderDiscoveryError(
                    502,
                    "response_too_large",
                    "Provider model response exceeded the size limit.",
                ) from exc
            raise ProviderDiscoveryError(
                502,
                "connectivity",
                "Could not connect to the provider model endpoint.",
            ) from exc
        except _DiscoveryResponseTooLarge as exc:
            raise ProviderDiscoveryError(
                502,
                "response_too_large",
                "Provider model response exceeded the size limit.",
            ) from exc
        finally:
            await client.close()

        if not isinstance(models, list) or not all(
            isinstance(item, dict) for item in models
        ):
            raise ProviderDiscoveryError(
                502,
                "malformed_response",
                "Provider response must contain a data array.",
            )
        return models


def _has_cause(error: BaseException, error_type: type[BaseException]) -> bool:
    current: BaseException | None = error
    while current is not None:
        if isinstance(current, error_type):
            return True
        current = current.__cause__ or current.__context__
    return False


def _extract_context_window(
    model: dict[str, object],
) -> tuple[int | None, bool]:
    values: set[int] = set()
    for key in (
        "context_window",
        "context_length",
        "max_context_length",
        "max_model_len",
    ):
        value = model.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            values.add(value)
    if len(values) == 1:
        return values.pop(), False
    return None, len(values) > 1


def _extract_vision(model: dict[str, object]) -> tuple[bool | None, bool]:
    values: set[bool] = set()
    explicit = model.get("supports_vision")
    if isinstance(explicit, bool):
        values.add(explicit)

    capabilities = model.get("capabilities")
    if isinstance(capabilities, dict):
        vision = capabilities.get("vision")
        if isinstance(vision, bool):
            values.add(vision)

    modality_sources: list[object] = [model.get("input_modalities")]
    architecture = model.get("architecture")
    if isinstance(architecture, dict):
        modality_sources.append(architecture.get("input_modalities"))
    for modalities in modality_sources:
        if isinstance(modalities, list) and any(
            isinstance(item, str) and item.lower() in {"image", "images"}
            for item in modalities
        ):
            values.add(True)

    if len(values) == 1:
        return values.pop(), False
    return None, len(values) > 1


def merge_discovered_models(
    existing_models: list[Llm],
    discovered_models: list[Llm],
    draft_model_id: uuid.UUID | None = None,
) -> list[Llm]:
    """Merge refresh results without replacing identity or manual metadata."""
    existing_by_name = {model.name: model for model in existing_models}
    merged: list[Llm] = []
    for discovered in discovered_models:
        existing = existing_by_name.get(discovered.name)
        if existing is None:
            merged.append(discovered)
            continue

        result = discovered.model_copy(
            update={
                "id": existing.id,
                "provider_id": existing.provider_id,
                "is_active": existing.is_active,
            }
        )
        if existing.context_window_source == ModelCapabilitySource.MANUAL:
            result.context_window = existing.context_window
            result.context_window_source = ModelCapabilitySource.MANUAL
        elif (
            discovered.context_window is None
            and existing.context_window is not None
        ):
            result.context_window = existing.context_window
            result.context_window_source = existing.context_window_source

        if existing.vision_source == ModelCapabilitySource.MANUAL:
            result.supports_vision = existing.supports_vision
            result.vision_source = ModelCapabilitySource.MANUAL
        elif (
            discovered.supports_vision is None
            and existing.supports_vision is not None
        ):
            result.supports_vision = existing.supports_vision
            result.vision_source = existing.vision_source
        merged.append(result)

    # A provider may temporarily omit a model. Keep the selected draft model so
    # refreshing metadata alone cannot invalidate the application setting.
    merged_ids = {model.id for model in merged}
    if draft_model_id is not None and draft_model_id not in merged_ids:
        selected = next(
            (model for model in existing_models if model.id == draft_model_id),
            None,
        )
        if selected is not None:
            merged.append(selected)
    return merged
