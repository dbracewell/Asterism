from pydantic import BaseModel, Field


class CreateUserRequest(BaseModel):
    user_id: str
    system_key: str | None = Field(
        default=None, description="Optional system key for user creation."
    )
