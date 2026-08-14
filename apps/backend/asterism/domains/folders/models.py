import uuid
from typing import Optional

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class FolderModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "folders"

    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        "title",
        String,
        nullable=False,
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "parent_id",
        ForeignKey(
            "folders.id",
            ondelete="CASCADE",
            name="fk_folders_parent_id",
        ),
        nullable=True,
        index=True,
    )

    __table_args__ = (Index("idx_folder_id_user", "id", "user_id"),)
