"""Provenance for imported packs. A record of origin only; it grants nothing."""

import uuid
from enum import StrEnum

from sqlalchemy import Enum, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class PackItemType(StrEnum):
    SUB_AGENT = "sub_agent"
    SKILL = "skill"
    TEMPLATE = "template"
    RUBRIC = "rubric"
    PROJECT = "project"


class PackImportModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """One confirmed import: which pack and version a user brought in."""

    __tablename__ = "pack_imports"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    pack_id: Mapped[str] = mapped_column(Text, nullable=False)
    pack_version: Mapped[str] = mapped_column(Text, nullable=False)
    pack_name: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (Index("idx_pack_imports_owner_pack", "user_id", "pack_id"),)


class PackImportItemModel(Base, UuidPrimaryKeyMixin):
    """A record created by an import. It outlives the record, as history."""

    __tablename__ = "pack_import_items"

    import_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pack_imports.id", ondelete="CASCADE"), nullable=False)
    item_type: Mapped[PackItemType] = mapped_column(
        Enum(PackItemType, values_callable=enum_values, native_enum=False, create_constraint=True),
        nullable=False,
    )
    # The project section has no key in the pack.
    item_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    record_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    __table_args__ = (Index("idx_pack_import_items_import", "import_id"),)
