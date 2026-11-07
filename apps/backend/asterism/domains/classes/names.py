"""Live names for classes and educator access (ADR-0057).

Names are read from the users table when shown, never copied, so a rename
appears everywhere at once. What each viewer may see is decided by the caller:
students see only who runs a class, educators see their own rosters, and only
administrators see email.
"""

from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

import asterism.domains.user.service as user_service

# Shown only if a user has no stored name.
EDUCATOR_FALLBACK = "Your educator"
STUDENT_FALLBACK = "Student"
USER_FALLBACK = "Unnamed user"


async def live_names(user_ids: Iterable[str], session: AsyncSession) -> dict[str, str]:
    """Current names by user id; users with no stored name are absent."""
    identities = await user_service.read_identities(user_ids, session)
    return {user_id: identity.name for user_id, identity in identities.items() if identity.name}


async def educator_name(educator_id: str, session: AsyncSession) -> str:
    return (await live_names([educator_id], session)).get(educator_id, EDUCATOR_FALLBACK)
