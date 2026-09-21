from pydantic import BaseModel, Field


class CreateUserRequest(BaseModel):
    """Request model for creating a new user."""

    user_id: str
    system_key: str | None = Field(default=None, description="Optional system key for user creation.")
