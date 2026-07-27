import uuid
from typing import Annotated

from pydantic import BaseModel, WithJsonSchema


class NewFolderRequest(BaseModel):
    title: str
    parent_id: Annotated[
        uuid.UUID | None,
        WithJsonSchema(
            {
                "nullable": True,
                "type": "string",
            }
        ),
    ]


class GetFolderRequest(BaseModel):
    id: uuid.UUID
    include_children: bool
