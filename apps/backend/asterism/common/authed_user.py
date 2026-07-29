from typing import Literal

from pydantic.dataclasses import dataclass


@dataclass(frozen=True)
class AuthedUser:
    id: str
    email: str
    name: str
    role: Literal["user", "admin"]
    timezone: str | None = None
