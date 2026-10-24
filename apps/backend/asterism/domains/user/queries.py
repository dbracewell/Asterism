"""User-owned persona query composition."""

from sqlalchemy import select

from .models import PersonaProfileModel


def select_owned_personas(*, user_id: str):
    return select(PersonaProfileModel).where(PersonaProfileModel.user_id == user_id)
