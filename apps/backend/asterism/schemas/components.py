from typing import Any

from pydantic import BaseModel


class ComponentResponse(BaseModel):
    type: str
    name: str
    parameters: dict[str, Any]


class ComponentListResponse(BaseModel):
    items: list[ComponentResponse]
