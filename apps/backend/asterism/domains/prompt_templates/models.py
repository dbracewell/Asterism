"""Owner-scoped prompt template documents with derived searchable metadata."""

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class PromptTemplateModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "prompt_templates"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # Canonical JSON of the validated TemplateDocument; name/description are derived from it.
    document: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        CheckConstraint("revision >= 1", name="ck_prompt_templates_revision"),
        CheckConstraint("length(trim(name)) BETWEEN 1 AND 80", name="ck_prompt_templates_name_length"),
        CheckConstraint("length(trim(description)) BETWEEN 1 AND 500", name="ck_prompt_templates_description_length"),
        CheckConstraint("length(document) BETWEEN 1 AND 65536", name="ck_prompt_templates_document_length"),
        Index("idx_prompt_templates_owner_updated", "user_id", "updated_at", "id"),
    )
