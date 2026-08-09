from typing import Any

from pydantic import BaseModel, Field


class ComponentResponse(BaseModel):
    type: str
    name: str
    parameters: dict[str, Any]


class ComponentListResponse(BaseModel):
    items: list[ComponentResponse]


class ComponentProviderParameters(BaseModel):
    name: str
    parameters: dict[str, str] = Field(default_factory=dict)
