from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class ToolModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "tools"

    name: Mapped[str] = mapped_column(
        "name",
        String,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        "description",
        Text,
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        "content",
        Text,
        nullable=False,
    )
