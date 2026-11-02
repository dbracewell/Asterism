"""Read-time recheck of saved message references against the live chat scope.

Inline files (ADR-0039), claim citations (ADR-0040) and verification evidence
(ADR-0041) are snapshots taken when they were saved. Every read that returns
messages marks the ones whose file has left the chat's scope as unavailable.
"""

import uuid
from collections.abc import Iterable

from .inline_files import apply_live_availability
from .schemas import Message
from .span_citations import apply_live_citations
from .verification import with_live_evidence


def apply_live_scope(messages: Iterable[Message], allowed: frozenset[uuid.UUID] | set[uuid.UUID]) -> None:
    messages = list(messages)
    apply_live_availability(messages, allowed)
    apply_live_citations(messages, allowed)
    for message in messages:
        message.verification = with_live_evidence(message.verification, allowed)
