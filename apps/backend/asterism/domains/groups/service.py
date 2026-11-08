"""Groups and membership (ADR-0058).

Membership is read live. The admin group mirrors the verified token role and is
never set through the membership API.
"""

import uuid
from dataclasses import dataclass
from typing import Literal

from cachetools import TTLCache
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.domains.user.models import UserModel

from .models import ADMIN_GROUP, EDUCATOR_GROUP, STUDENT_GROUP, GroupModel
from .schemas import Group, GroupRef

logger = get_logger("Groups")

# user id -> the token role last mirrored onto the row.
_mirrored_roles = TTLCache[str, str](maxsize=1000, ttl=3600)


def clear_group_cache() -> None:
    _mirrored_roles.clear()


async def read_group_id(user_id: str, session: AsyncSession) -> str | None:
    """The user's group, read live; None if there is no such user."""
    return await session.scalar(select(UserModel.group_id).where(UserModel.id == user_id))


async def read_group_refs(user_ids: list[str], session: AsyncSession) -> dict[str, GroupRef]:
    """Each user's group id and name, in one query."""
    if not user_ids:
        return {}
    rows = await session.execute(
        select(UserModel.id, GroupModel.id, GroupModel.name)
        .join(GroupModel, GroupModel.id == UserModel.group_id)
        .where(UserModel.id.in_(set(user_ids)))
    )
    return {user_id: GroupRef(id=group_id, name=name) for user_id, group_id, name in rows}


async def mirror_admin_role(user_id: str, role: Literal["user", "admin"], session: AsyncSession) -> None:
    """Keep the admin group in line with the token role; a cached no-op when unchanged."""
    if _mirrored_roles.get(user_id) == role:
        return
    if role == "admin":
        statement = update(UserModel).where(UserModel.id == user_id, UserModel.group_id != ADMIN_GROUP)
        result = await session.execute(statement.values(group_id=ADMIN_GROUP))
    else:
        statement = update(UserModel).where(UserModel.id == user_id, UserModel.group_id == ADMIN_GROUP)
        result = await session.execute(statement.values(group_id=STUDENT_GROUP))
    if getattr(result, "rowcount", 0):
        await session.commit()
        logger.info(f"Mirrored the {role} role onto user {user_id}'s group")
    _mirrored_roles[user_id] = role


async def list_groups(session: AsyncSession) -> list[Group]:
    """Every group with its member count: built-ins first, then by name."""
    members = select(UserModel.group_id, func.count().label("count")).group_by(UserModel.group_id).subquery()
    rows = await session.execute(
        select(GroupModel, func.coalesce(members.c.count, 0))
        .outerjoin(members, members.c.group_id == GroupModel.id)
        .order_by(GroupModel.built_in.desc(), func.lower(GroupModel.name), GroupModel.id)
    )
    return [_view(group, count) for group, count in rows]


def _view(group: GroupModel, member_count: int) -> Group:
    return Group(
        id=group.id,
        name=group.name,
        built_in=group.built_in,
        member_count=member_count,
        models=None if group.model_access is None else [uuid.UUID(value) for value in group.model_access],
        tools=group.tool_access,
    )


@dataclass(frozen=True)
class GroupAccess:
    """What a user's group allows (US-70.2). None allows everything the administrator enabled.

    Group access only narrows admin policy; it never enables anything.
    """

    models: frozenset[uuid.UUID] | None = None
    tools: frozenset[str] | None = None

    def allows_model(self, model_id: uuid.UUID) -> bool:
        return self.models is None or model_id in self.models

    def allows_tool(self, name: str) -> bool:
        return self.tools is None or name in self.tools


async def read_access(user_id: str, session: AsyncSession) -> GroupAccess:
    """The user's group access, read live on every check."""
    row = (
        await session.execute(
            select(GroupModel.model_access, GroupModel.tool_access)
            .join(UserModel, UserModel.group_id == GroupModel.id)
            .where(UserModel.id == user_id)
        )
    ).first()
    if row is None:
        return GroupAccess()
    models, tools = row
    return GroupAccess(
        models=None if models is None else frozenset(uuid.UUID(value) for value in models),
        tools=None if tools is None else frozenset(tools),
    )


async def set_access(
    *,
    group_id: str,
    models: list[uuid.UUID] | None,
    tools: list[str] | None,
    configurable_tools: set[str],
    admin_id: str,
    session: AsyncSession,
) -> Group:
    """Replace a group's model and tool lists; only shared models and configurable tools can be listed."""
    from asterism.domains.settings.models import LLMModel, ProviderModel

    group = await _require_group(group_id, session)
    if models is not None:
        wanted = set(models)
        known = set(
            await session.scalars(
                select(LLMModel.id)
                .join(ProviderModel, ProviderModel.id == LLMModel.provider_id)
                .where(LLMModel.id.in_(wanted), ProviderModel.owner_user_id.is_(None))
            )
        )
        if unknown := wanted - known:
            raise BadDataException(f"Unknown shared models: {', '.join(sorted(map(str, unknown)))}")
        group.model_access = sorted(str(model_id) for model_id in wanted)
    else:
        group.model_access = None
    if tools is not None:
        if unknown_tools := set(tools) - configurable_tools:
            raise BadDataException(f"Unknown tools: {', '.join(sorted(unknown_tools))}")
        group.tool_access = sorted(set(tools))
    else:
        group.tool_access = None
    await session.commit()
    logger.info(f"Admin {admin_id} changed model and tool access for group {group_id}")
    return _view(group, await _count(group_id, session))


async def _count(group_id: str, session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).where(UserModel.group_id == group_id)) or 0


async def _require_group(group_id: str, session: AsyncSession) -> GroupModel:
    group = await session.get(GroupModel, group_id)
    if group is None:
        raise NotFoundException("Group not found")
    return group


def _require_custom(group: GroupModel, action: str) -> None:
    if group.built_in:
        raise ConflictException(f"Built-in groups can't be {action}")


async def _commit_name(group: GroupModel, session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise ConflictException("A group with that name already exists") from error


async def create_group(*, name: str, admin_id: str, session: AsyncSession) -> Group:
    group = GroupModel(name=name)
    session.add(group)
    await _commit_name(group, session)
    logger.info(f"Admin {admin_id} created group {group.id}")
    return _view(group, 0)


async def rename_group(*, group_id: str, name: str, admin_id: str, session: AsyncSession) -> Group:
    group = await _require_group(group_id, session)
    _require_custom(group, "renamed")
    group.name = name
    await _commit_name(group, session)
    logger.info(f"Admin {admin_id} renamed group {group_id}")
    return _view(group, await _count(group_id, session))


async def delete_group(*, group_id: str, admin_id: str, session: AsyncSession) -> None:
    """Refused while the group has members, so nobody's access changes unnoticed."""
    group = await _require_group(group_id, session)
    _require_custom(group, "deleted")
    if members := await _count(group_id, session):
        raise ConflictException(f"Move this group's {members} member(s) to another group before deleting it")
    await session.delete(group)
    await session.commit()
    logger.info(f"Admin {admin_id} deleted group {group_id}")


async def move_user(*, user_id: str, group_id: str, admin_id: str, session: AsyncSession) -> GroupRef:
    """Put a non-admin user into a non-admin group.

    Moving into the educator group grants educator access, so a pending request
    is resolved with it; moving out revokes it.
    """
    from asterism.domains.classes.models import EducatorRequestModel

    current = await read_group_id(user_id, session)
    if current is None:
        raise NotFoundException("User not found")
    group = await _require_group(group_id, session)
    if ADMIN_GROUP in (current, group_id):
        raise ConflictException("The admin group follows the sign-in admin role and can't be changed here")
    await session.execute(update(UserModel).where(UserModel.id == user_id).values(group_id=group_id))
    if group_id == EDUCATOR_GROUP:
        await session.execute(delete(EducatorRequestModel).where(EducatorRequestModel.user_id == user_id))
    await session.commit()
    logger.info(f"Admin {admin_id} moved user {user_id} from group {current} to {group_id}")
    return GroupRef(id=group.id, name=group.name)
