"""Scoped base selects for classes; callers add filters before pagination."""

from sqlalchemy import select

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
