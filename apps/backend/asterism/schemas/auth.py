from pydantic import BaseModel, Field


class UserMeResponse(BaseModel):
    id: str
    email: str | None = None
    display_name: str | None = None
    roles: list[str] = Field(default_factory=list)


class SetupStatusResponse(BaseModel):
    requires_setup: bool
    is_current_user_admin: bool


class BootstrapAdminRequest(BaseModel):
    setup_token: str


class BootstrapAdminResponse(BaseModel):
    id: str
    roles: list[str] = Field(default_factory=list)
