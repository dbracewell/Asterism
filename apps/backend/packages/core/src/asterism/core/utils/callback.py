from typing import Any

import requests
from pydantic import BaseModel

from asterism.core import config


def post_callback(
    event_type: str,
    payload: BaseModel,
    user_id: str | None = None,
) -> None:
    response = requests.post(
        url=f"{config.FRONT_END_URL}/api/stream",
        headers={"x-asterism-system-key": config.SYSTEM_KEY},
        json={
            "type": event_type,
            "payload": payload.model_dump(mode="json"),
            "userId": user_id,
        },
    )
    response.raise_for_status()
