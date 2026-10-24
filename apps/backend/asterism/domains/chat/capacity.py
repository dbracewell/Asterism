"""Finite single-process admission policy for chat work and controllers."""

from dataclasses import dataclass

from asterism.core.exceptions import CodedException


class ChatCapacityError(CodedException):
    def __init__(self, message: str = "Chat capacity is full. Retry shortly."):
        super().__init__(503, message)

    def packet(self) -> dict:
        return {
            "type": "error",
            "code": self.code,
            "error_code": "chat_capacity",
            "retryable": True,
            "content": str(self),
        }


@dataclass(frozen=True)
class ChatCapacityLimits:
    active_jobs: int = 32
    active_jobs_per_user: int = 4
    controllers: int = 128
    controllers_per_user: int = 16

    def __post_init__(self):
        if not 1 <= self.active_jobs <= 256 or not 1 <= self.active_jobs_per_user <= self.active_jobs:
            raise ValueError("Chat work limits require 1 <= per-user <= global <= 256")
        if not 1 <= self.controllers <= 512 or not 1 <= self.controllers_per_user <= self.controllers:
            raise ValueError("Chat controller limits require 1 <= per-user <= global <= 512")
