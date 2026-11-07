"""Pydantic request/response schemas for the user domain API."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints


class CreateUserRequest(BaseModel):
    """Request model for creating a new user.

    Attributes:
        user_id: The stable identifier to provision. Must match the id claim
            of the BetterAuth token this user will present.
        name: The account's current display name, copied for display.
        email: The account's current email, copied for administrators.
        system_key: Optional shared secret (``SYSTEM_KEY``) that lets an
            unauthenticated caller create users. When omitted, the caller must
            be an authenticated admin.
    """

    user_id: str
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=320)] | None = None
    system_key: str | None = Field(
        default=None,
        description="Optional system key for user creation.",
    )
