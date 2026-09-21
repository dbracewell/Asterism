"""Token estimation for pre-request context-window protection."""

from functools import lru_cache

import tiktoken


@lru_cache(maxsize=128)
def _encoding(model_name: str | None) -> tiktoken.Encoding:
    if model_name:
        try:
            return tiktoken.encoding_for_model(model_name)
        except KeyError:
            pass
    return tiktoken.get_encoding("cl100k_base")


def encoding_cache_size() -> int:
    """Return a content-free aggregate diagnostic for the bounded cache."""
    return _encoding.cache_info().currsize


def estimate_text_tokens(text: str, model_name: str | None = None) -> int:
    """Estimate text tokens using a known model encoding or cl100k fallback.

    This is intentionally only used before a provider call. Provider-reported
    usage remains authoritative after a completion.
    """
    return len(_encoding(model_name).encode(text))
