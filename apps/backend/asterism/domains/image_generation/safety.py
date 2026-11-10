"""The platform's fixed prompt check, applied before any provider runs (ADR-0064).

Lightly filtered models are a deliberate choice, so this check is not
configurable: a prompt that pairs a minor with sexual content is refused and
logged. It is a word-level baseline, not a classifier; it errs toward refusing.
"""

import re

_MINOR = re.compile(
    r"\b(child|children|kids?|minors?|underage|under-age|preteens?|pre-teens?|teens?|teenagers?|teenage|"
    r"toddlers?|infants?|bab(?:y|ies)|schoolgirls?|schoolboys?|loli(?:ta|con)?|shota(?:con)?|"
    r"(?:young|little)\s+(?:girls?|boys?)|(?:1[0-7]|[1-9])\s*-?\s*(?:years?|yrs?|yo)\b(?:\s*-?\s*old)?)\b"
)
_SEXUAL = re.compile(
    r"\b(nude|nudity|naked|nsfw|sex|sexy|sexual|sexualized|erotic|erotica|porn\w*|lewd|hentai|"
    r"lingerie|topless|bottomless|undress(?:ed|ing)?|explicit|genitals?|breasts?|nipples?|seductive|"
    r"fetish|orgasm|aroused|intercourse|strip(?:ping|per)?)\b"
)
_ALWAYS = re.compile(r"\b(loli(?:con)?|shota(?:con)?|cp|csam)\b")


def _normalize(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9\s-]", " ", text.lower()).split())


def refusal_reason(*texts: str) -> str | None:
    """Why the request is refused, or None. Checks the prompt and negative prompt together."""
    text = _normalize(" ".join(texts))
    if _ALWAYS.search(text) or (_MINOR.search(text) and _SEXUAL.search(text)):
        return "This request can't be generated: it pairs a minor with sexual content."
    return None
