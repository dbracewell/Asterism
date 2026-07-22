from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class AuthedUser:
    id: str
    email: str
    name: str
    role: Literal["user", "admin"]
