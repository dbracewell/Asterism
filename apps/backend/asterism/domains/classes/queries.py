"""Scoped base selects for classes; callers add filters before pagination."""

import uuid
from collections.abc import Collection

from sqlalchemy import func, select

from .models import ClassMemberModel, ClassModel


def select_taught_classes(user_id: str):
    return select(ClassModel).where(ClassModel.educator_id == user_id)


def select_joined_classes(user_id: str):
    """Classes a student is in now. A removed student is no longer in the class."""
    return (
        select(ClassModel)
        .join(ClassMemberModel, ClassMemberModel.class_id == ClassModel.id)
        .where(ClassMemberModel.user_id == user_id, ClassMemberModel.removed_at.is_(None))
    )


def select_member_counts(class_ids: Collection[uuid.UUID]):
    """``(class id, current member count)`` for the classes that have members."""
    return (
        select(ClassMemberModel.class_id, func.count())
        .where(ClassMemberModel.class_id.in_(class_ids), ClassMemberModel.removed_at.is_(None))
        .group_by(ClassMemberModel.class_id)
    )


def select_insights_consent(user_id: str, class_ids: Collection[uuid.UUID]):
    """``(class id, insights consent)`` for the user's memberships of the classes."""
    return select(ClassMemberModel.class_id, ClassMemberModel.insights_consent).where(
        ClassMemberModel.user_id == user_id, ClassMemberModel.class_id.in_(class_ids)
    )
