"""Token estimation for pre-request context-window protection.

Estimates only — used to bound prompt size *before* a provider call (e.g. when
trimming delegated sub-agent context). After a completion, the usage block
reported by the provider is authoritative and this module is not consulted.
"""

from functools import lru_cache

import tiktoken


@lru_cache(maxsize=128)
def _encoding(model_name: str | None) -> tiktoken.Encoding:
    """Resolve a tiktoken encoding for a model, falling back to cl100k_base.

    Unknown/None model names (most local servers) use the GPT-3.5-era
    cl100k_base encoding as a generic approximation. Results are cached per
    distinct model name (bounded to 128 entries).
    """
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
    return len(_encoding(model_name).encode(text, disallowed_special=()))
