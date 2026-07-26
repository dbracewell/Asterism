from typing import Annotated

from pydantic import BaseModel, WithJsonSchema
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from . import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column("id", String, primary_key=True)


class CreateUserRequest(BaseModel):
    user_id: str
    system_key: Annotated[
        str | None,
        WithJsonSchema(
            {
                "nullable": True,
                "type": "string",
            }
        ),
    ] = None
