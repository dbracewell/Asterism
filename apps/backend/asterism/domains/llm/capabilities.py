"""Per-provider request capabilities: wire API, generation parameters, tool kinds.

Providers differ in which request fields they accept. Rather than letting a
provider reject a request, each client consults its ``RequestCapabilities`` and
omits generation parameters and tool kinds the provider does not support. The
capabilities are chosen per provider type by :func:`request_capabilities`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from asterism.domains.settings.provider_types import ProviderType

from .schemas import ChatCompletionParams


class LLMApi(StrEnum):
    """Wire API a provider speaks."""

    CHAT_COMPLETIONS = "chat_completions"
    RESPONSES = "responses"


class ToolKind(StrEnum):
    """Tool definition kinds a provider can accept in a request."""

    FUNCTION = "function"


@dataclass(frozen=True)
class RequestCapabilities:
    """What a provider accepts in a generation request.

    Fields:
        api: Wire API used for generation.
        parameters: ``ChatCompletionParams`` keys forwarded to the provider;
            any other caller-supplied parameter is omitted.
        tool_kinds: Tool definition kinds forwarded to the provider; schemas of
            any other kind are omitted.
    """

    api: LLMApi
    parameters: frozenset[str]
    tool_kinds: frozenset[ToolKind]

    def request_parameters(self, params: Mapping[str, Any]) -> dict[str, Any]:
        """Return only the supported parameters from ``params``."""
        return {key: value for key, value in params.items() if key in self.parameters}

    def supported_tools[T: Mapping[str, Any]](self, schemas: Sequence[T]) -> list[T]:
        """Return only the tool schemas whose ``type`` is a supported kind."""
        return [schema for schema in schemas if schema.get("type") in self.tool_kinds]


# OpenAI-compatible Chat Completions providers accept every parameter Asterism
# defines; behavior is unchanged from forwarding them verbatim.
CHAT_COMPLETIONS_CAPABILITIES = RequestCapabilities(
    api=LLMApi.CHAT_COMPLETIONS,
    parameters=frozenset(ChatCompletionParams.__annotations__),
    tool_kinds=frozenset({ToolKind.FUNCTION}),
)

# ChatGPT plan usage over the Responses API rejects sampling and output-limit
# fields (temperature, top_p, max_output_tokens, ...) and hosted tools such as
# image generation, file search and MCP connectors.
CHATGPT_PLAN_CAPABILITIES = RequestCapabilities(
    api=LLMApi.RESPONSES,
    parameters=frozenset(
        {
            "reasoning_effort",
            "tool_choice",
            "parallel_tool_calls",
            "extra_headers",
            "extra_query",
            "timeout",
        },
    ),
    tool_kinds=frozenset({ToolKind.FUNCTION}),
)


def request_capabilities(provider_type: ProviderType) -> RequestCapabilities:
    """Return the request capabilities for a provider type."""
    match provider_type:
        case ProviderType.OPENAI | ProviderType.GENERIC_OPENAI:
            return CHAT_COMPLETIONS_CAPABILITIES
        case ProviderType.CHATGPT:
            return CHATGPT_PLAN_CAPABILITIES
