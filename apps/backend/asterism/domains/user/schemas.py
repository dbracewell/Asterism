"""Pydantic request/response schemas for the user domain API."""

from typing import Annotated, Literal

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


class UserSummary(BaseModel):
    """One account in the administrator's user list."""

    id: str
    name: str | None = Field(description="The current name from sign-in, or null if not yet known")
    email: str | None = Field(description="The current email from sign-in, or null if not yet known")
    educator: Literal["pending", "approved"] | None = Field(
        description="Educator status, if they have asked. Admin roles live in sign-in and are not shown"
    )
    created_at: int = Field(description="When the account was first seen, in Unix seconds")


class UserSummaryPage(BaseModel):
    items: list[UserSummary]
    total: int
    page: int
    page_size: int
