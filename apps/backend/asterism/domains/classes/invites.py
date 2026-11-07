"""Single-use student invites (ADR-0053).

An invite creates an ordinary account and joins one class. Only a SHA-256 hash
of the token is stored. Every refused invite gives the same error, so the
signup page can't be used to learn why one failed.
"""

import hashlib
import hmac
import secrets
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import asterism.domains.user.service as user_service
from asterism.common.log import get_logger
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException, UnauthorizedException
from asterism.db.mixins import get_unix_timestamp
from asterism.db.queries import paginate_select

from .models import ClassInviteModel, ClassMemberModel, ClassModel, EducatorModel, EducatorStatus
from .schemas import (
    ClassInvite,
    ClassInvitePage,
    CreatedClassInvite,
    CreatedClassInviteList,
    InvitePreview,
)
from .service import owned_class

logger = get_logger("ClassInvites")

INVITE_LIFETIME_SECONDS = 14 * 24 * 60 * 60
INVALID_INVITE = "This invite can't be used. Ask your educator for a new one."


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.strip().encode()).hexdigest()


def require_system_key(candidate: str) -> None:
    """The check and redeem routes are server-to-server only."""
    if not (config.system_key and hmac.compare_digest(candidate.encode(), config.system_key.encode())):
        raise UnauthorizedException()


def invite_status(row: ClassInviteModel, now: int) -> str:
    if row.redeemed_at is not None:
        return "used"
    if row.revoked_at is not None:
        return "revoked"
    if row.expires_at <= now:
        return "expired"
    return "unused"


def _view(row: ClassInviteModel, now: int) -> ClassInvite:
    return ClassInvite(
        id=row.id,
        label=row.label,
        status=invite_status(row, now),  # type: ignore[arg-type]
        expires_at=row.expires_at,
        created_at=row.created_at,
        redeemed_at=row.redeemed_at,
        redeemed_name=row.redeemed_name,
    )


async def create_invites(
    user_id: str, class_id: uuid.UUID, labels: list[str], session: AsyncSession
) -> CreatedClassInviteList:
    await owned_class(user_id, class_id, session)
    expires_at = get_unix_timestamp() + INVITE_LIFETIME_SECONDS
    created: list[tuple[ClassInviteModel, str]] = []
    for label in labels:
        token = secrets.token_urlsafe(24)
        row = ClassInviteModel(
            class_id=class_id, token_hash=hash_invite_token(token), label=label, expires_at=expires_at
        )
        session.add(row)
        created.append((row, token))
    await session.commit()
    logger.info(f"Educator {user_id} created {len(created)} invites for class {class_id}")
    return CreatedClassInviteList(
        items=[
            CreatedClassInvite(id=row.id, label=row.label, token=token, expires_at=row.expires_at)
            for row, token in created
        ]
    )


async def list_invites(
    user_id: str, class_id: uuid.UUID, session: AsyncSession, *, page: int, page_size: int
) -> ClassInvitePage:
    await owned_class(user_id, class_id, session)
    result = await paginate_select(
        statement=select(ClassInviteModel)
        .where(ClassInviteModel.class_id == class_id)
        .order_by(ClassInviteModel.created_at.desc(), ClassInviteModel.label, ClassInviteModel.id),
        session=session,
        page=page,
        page_size=page_size,
    )
    now = get_unix_timestamp()
    return ClassInvitePage(
        items=[_view(row, now) for row in result.records], total=result.total, page=page, page_size=page_size
    )


async def revoke_invite(user_id: str, class_id: uuid.UUID, invite_id: uuid.UUID, session: AsyncSession) -> None:
    await owned_class(user_id, class_id, session)
    row = await session.scalar(
        select(ClassInviteModel).where(ClassInviteModel.id == invite_id, ClassInviteModel.class_id == class_id)
    )
    if row is None:
        raise NotFoundException("Invite not found")
    if row.redeemed_at is not None:
        raise BadDataException("This invite has already been used")
    row.revoked_at = row.revoked_at or get_unix_timestamp()
    await session.commit()
    logger.info(f"Educator {user_id} revoked invite {invite_id}")


def _usable_invite(token: str, now: int):
    """Unused, unrevoked and unexpired, in a class whose educator still has access."""
    return (
        select(ClassInviteModel, ClassModel)
        .join(ClassModel, ClassModel.id == ClassInviteModel.class_id)
        .join(EducatorModel, EducatorModel.user_id == ClassModel.educator_id)
        .where(
            ClassInviteModel.token_hash == hash_invite_token(token),
            ClassInviteModel.redeemed_at.is_(None),
            ClassInviteModel.revoked_at.is_(None),
            ClassInviteModel.expires_at > now,
            EducatorModel.status == EducatorStatus.APPROVED,
        )
    )


async def check_invite(token: str, session: AsyncSession) -> InvitePreview:
    found = (await session.execute(_usable_invite(token, get_unix_timestamp()))).first()
    if found is None:
        raise BadDataException(INVALID_INVITE)
    _, row = found
    return InvitePreview(class_name=row.name, educator_name=row.educator_name)


async def redeem_invite(token: str, *, user_id: str, display_name: str, session: AsyncSession) -> InvitePreview:
    """Claim the invite, create the user and join the class in one transaction.

    The claim is a conditional update, so of two signups racing for one invite
    exactly one succeeds. The caller deletes its new account when this fails.
    """
    now = get_unix_timestamp()
    found = (await session.execute(_usable_invite(token, now))).first()
    # Invites are only for new accounts; never re-provision an existing one.
    if found is None or await user_service.user_exists(user_id, session):
        raise BadDataException(INVALID_INVITE)
    invite, class_row = found
    claimed = await session.execute(
        update(ClassInviteModel)
        .where(
            ClassInviteModel.id == invite.id,
            ClassInviteModel.redeemed_at.is_(None),
            ClassInviteModel.revoked_at.is_(None),
        )
        .values(redeemed_at=now, redeemed_name=display_name)
        .returning(ClassInviteModel.id)
    )
    if claimed.scalar_one_or_none() is None:
        await session.rollback()
        raise BadDataException(INVALID_INVITE)
    # Commits the claim together with the new user row and main-agent config.
    outcome = await user_service.create_user(user_id=user_id, session=session)
    if outcome is not user_service.UserCreateOutcome.CREATED:
        # Lost a race with another creation of this id; create_user rolled the claim back.
        raise BadDataException(INVALID_INVITE)
    await session.execute(update(ClassInviteModel).where(ClassInviteModel.id == invite.id).values(redeemed_by=user_id))
    session.add(ClassMemberModel(class_id=class_row.id, user_id=user_id, display_name=display_name))
    await session.commit()
    logger.info(f"User {user_id} signed up with invite {invite.id} and joined class {class_row.id}")
    return InvitePreview(class_name=class_row.name, educator_name=class_row.educator_name)
