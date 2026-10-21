"""Pydantic request/response schemas for the user domain API."""

from pydantic import BaseModel, Field


class CreateUserRequest(BaseModel):
    """Request model for creating a new user.

    Attributes:
        user_id: The stable identifier to provision. Must match the id claim
            of the BetterAuth token this user will present; Asterism stores no
            other identity data.
        system_key: Optional shared secret (``SYSTEM_KEY``) that lets an
            unauthenticated caller create users. When omitted, the caller must
            be an authenticated admin.
    """

    user_id: str
    system_key: str | None = Field(
        default=None,
        description="Optional system key for user creation.",
    )
