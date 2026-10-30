"""Singleton wrapper around the admin-configured "draft" model.

The draft model is a cheap/fast model chosen in application settings for
utility generation (e.g. chat-title drafting). This module owns one process-wide
wrapper that lazily builds an LLM client from current settings and drops it
whenever the admin updates the draft-model setting, so the next call picks up
the new provider/model binding.
"""

from typing import Unpack

import asterism.domains.settings.service as settings_service
from asterism.core.events import Event, EventType, event_bus

from .factory import create_llm_client
from .schemas import ChatCompletionParams, LLMClientProtocol, LLMMessage


class NoModelDefinedException(Exception):
    """Raised when no draft model is configured. Currently never raised —
    settings resolution surfaces ``NotFoundException``/``BadDataException``
    instead."""

    def __init__(self, message: str = "No draft model defined."):
        super().__init__(message)


class DraftModel:
    """Lazy, cached client for the configured draft model (see module docstring)."""

    def __init__(self):
        self._llm_client: LLMClientProtocol | None = None

    async def get_model(self) -> LLMClientProtocol:
        """Return the cached client, building it from settings on first use.

        Raises ``NotFoundException``/``BadDataException`` when the draft model
        is unset or inactive (propagated from the settings service).
        """
        if self._llm_client is not None:
            return self._llm_client

        draft_model = await settings_service.get_draft_model()
        client = create_llm_client(draft_model.name, draft_model.provider)
        self._llm_client = client
        return client

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
