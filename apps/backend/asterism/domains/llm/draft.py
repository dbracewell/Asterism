"""Singleton wrapper around the admin-configured "draft" model.

The draft model is a cheap/fast model chosen in application settings for
utility generation (e.g. chat-title drafting). This module owns one process-wide
wrapper that lazily builds an LLM client from current settings and drops it
whenever the admin updates the draft-model setting, so the next call picks up
the new provider/model binding.
"""

import uuid
from typing import Unpack

import asterism.domains.settings.service as settings_service
from asterism.core.events import Event, EventType, event_bus
from asterism.domains.settings.schemas import LlmWithProvider
from asterism.domains.usage.schemas import UsageSource

from .factory import create_llm_client
from .metering import meter_for, metered
from .schemas import ChatCompletionParams, LLMClientProtocol, LLMMessage


class NoModelDefinedException(Exception):
    """Raised when no draft model is configured. Currently never raised —
    settings resolution surfaces ``NotFoundException``/``BadDataException``
    instead."""

    def __init__(self, message: str = "No draft model defined."):
        super().__init__(message)


class DraftModel:
    """Lazy, cached client for the configured draft model (see module docstring).

    The shared client is unmetered; :meth:`charged_to` gives a per-call view
    that charges each call to one user (ADR-0073).
    """

    def __init__(self):
        self._llm_client: LLMClientProtocol | None = None
        self._info: LlmWithProvider | None = None

    async def _load(self) -> tuple[LLMClientProtocol, LlmWithProvider | None]:
        if self._llm_client is None:
            draft_model = await settings_service.get_draft_model()
            # Shared across users; each use is wrapped with its own meter.
            self._llm_client = create_llm_client(draft_model.name, draft_model.provider, usage=None)
            self._info = draft_model
        return self._llm_client, self._info

    async def get_model(self) -> LLMClientProtocol:
        """Return the cached client, building it from settings on first use.

        Raises ``NotFoundException``/``BadDataException`` when the draft model
        is unset or inactive (propagated from the settings service).
        """
        return (await self._load())[0]

    def charged_to(self, user_id: str, source: UsageSource, chat_id: uuid.UUID | None = None) -> "DraftModel":
        """The same model, with each call charged to ``user_id`` for ``source``."""
        return ChargedDraftModel(self, user_id=user_id, source=source, chat_id=chat_id)

    async def invoke(
        self,
        messages: list[LLMMessage],
        **kwargs: Unpack[ChatCompletionParams],
    ) -> str:
        """Run a non-streaming completion and return its text ("" when empty).

        Args:
            messages: Conversation to send.
            **kwargs: Optional completion parameters forwarded to the provider.

        Raises the underlying exception if the terminal event carries one.
        """
        llm = await self.get_model()
        event = await llm.generate(
            messages=messages,
            **kwargs,
        )
        # A normal completion can legitimately have no visible text (for
        # example, if a provider spends its generation budget on reasoning).
        # Do not stringify its absent exception as the literal title "None".
        if event.exception:
            raise event.exception

        if event.content:
            return event.content

        return ""


class ChargedDraftModel(DraftModel):
    """A view of the shared draft model whose calls are charged to one user."""

    def __init__(self, shared: DraftModel, *, user_id: str, source: UsageSource, chat_id: uuid.UUID | None) -> None:
        super().__init__()
        self._shared = shared
        self._user_id = user_id
        self._source = source
        self._chat_id = chat_id

    async def get_model(self) -> LLMClientProtocol:
        client, info = await self._shared._load()
        if info is None:
            return client
        return metered(client, meter_for(self._user_id, self._source, info, chat_id=self._chat_id))


# Process-wide singleton; reset (not mutated) when the draft model changes.
_draft_model: DraftModel | None = None


def get_draft_model() -> DraftModel:
    """Return the process-wide ``DraftModel`` wrapper, creating it if needed."""
    global _draft_model
    if _draft_model is None:
        _draft_model = DraftModel()
    return _draft_model


@event_bus.on(EventType.DRAFT_MODEL_UPDATED)
async def _on_model_update(_: Event) -> None:
    """Invalidate the cached client when the admin updates the draft model."""
    global _draft_model
    _draft_model = None
