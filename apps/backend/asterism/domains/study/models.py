"""User-owned study decks and cards, scoped to a project (ADR-0033).

Every row carries a denormalized ``user_id`` so composite foreign keys pin a
deck to its owner's project and a card to its owner's deck. Deleting a project
(or a user, through projects) cascades to its decks and their cards.
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

MAX_DECK_NAME_CHARS = 120
MAX_DECK_DESCRIPTION_CHARS = 2_000
MAX_CARD_SIDE_CHARS = 4_000


class StudyDeckModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "study_decks"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(MAX_DECK_NAME_CHARS), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_study_decks_project_owner",
        ),
        # Lets cards reference (id, user_id) as a composite foreign key.
        UniqueConstraint("id", "user_id", name="uq_study_decks_id_user"),
        CheckConstraint(
            f"length(trim(name)) > 0 AND length(name) <= {MAX_DECK_NAME_CHARS}", name="ck_study_decks_name"
        ),
        CheckConstraint(f"length(description) <= {MAX_DECK_DESCRIPTION_CHARS}", name="ck_study_decks_description"),
        Index("idx_study_decks_project", "user_id", "project_id", "updated_at", "id"),
    )


class StudyCardModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "study_cards"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    deck_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)
    # Canonical JSON list of StudyCitationInput; validated by the service, never a foreign key.
    citations: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")

    __table_args__ = (
        ForeignKeyConstraint(
            ["deck_id", "user_id"],
            ["study_decks.id", "study_decks.user_id"],
            ondelete="CASCADE",
            name="fk_study_cards_deck_owner",
        ),
        CheckConstraint(
            f"length(trim(front)) > 0 AND length(front) <= {MAX_CARD_SIDE_CHARS}", name="ck_study_cards_front"
        ),
        CheckConstraint(
            f"length(trim(back)) > 0 AND length(back) <= {MAX_CARD_SIDE_CHARS}", name="ck_study_cards_back"
        ),
        Index("idx_study_cards_deck", "user_id", "deck_id", "created_at", "id"),
    )
