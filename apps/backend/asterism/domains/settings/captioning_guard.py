"""The captioning-selection guard the settings domain needs from the knowledge domain.

The captioning selection is knowledge-domain state, but the rule that protects
it fires inside settings-domain provider and model mutations. The settings
domain therefore owns the *interface* it depends on, and the knowledge domain
registers the implementation. The dependency points at a published contract
instead of at the knowledge package, so ``settings`` never imports
``asterism.domains.knowledge``.

The guard is fail-closed: a provider mutation that cannot reach the guard
raises instead of silently dropping the protection.
"""

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


class CaptioningSelectionGuard(Protocol):
    """Rejects a provider or model edit that would orphan the captioning selection."""

    async def validate(self, *, session: AsyncSession) -> None:
        """Raise when the stored captioning selection would become invalid.

        Args:
            session: Active async session; the caller owns the transaction.

        Raises:
            Exception: The domain's own rejection error when the selection
                would no longer be valid.
        """
        ...


_guard: CaptioningSelectionGuard | None = None


def configure_captioning_selection_guard(guard: CaptioningSelectionGuard) -> None:
    """Install the guard that validates the stored captioning selection.

    Args:
        guard: The implementation that knows the captioning selection.
    """
    global _guard
    _guard = guard


def get_captioning_selection_guard() -> CaptioningSelectionGuard:
    """Return the installed captioning-selection guard.

    Returns:
        The registered guard.

    Raises:
        RuntimeError: If no guard has been installed. Failing closed keeps a
            provider edit from silently orphaning the captioning selection.
    """
    if _guard is None:
        raise RuntimeError("The captioning-selection guard has not been configured")
    return _guard
