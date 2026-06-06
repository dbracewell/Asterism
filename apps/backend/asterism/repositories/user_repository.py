from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.models.role import Role
from asterism.models.user import User
from asterism.models.user_role import UserRole

USER_ROLE = "user"
ADMIN_ROLE = "admin"
DEFAULT_ROLE_NAMES = (USER_ROLE, ADMIN_ROLE)


class UserRepository:
    def __init__(self, db_session: AsyncSession):
        self.session = db_session

    async def ensure_default_roles(self) -> None:
        existing_roles = await self.session.execute(select(Role.name))
        existing_role_names = set(existing_roles.scalars().all())

        for role_name in DEFAULT_ROLE_NAMES:
            if role_name not in existing_role_names:
                self.session.add(Role(name=role_name))

        await self.session.flush()

    async def get_or_create_user(
        self,
        *,
        user_id: str,
        email: str | None,
        display_name: str | None,
    ) -> User:
        await self.ensure_default_roles()

        query: Select[tuple[User]] = select(User).where(User.id == user_id)
        result = await self.session.execute(query)
        user = result.scalar_one_or_none()

        if user is None:
            user = User(id=user_id, email=email, display_name=display_name)
            self.session.add(user)
            await self.session.flush()
            await self.add_role(user, USER_ROLE)
            await self.session.commit()
            await self.session.refresh(user)
            return user

        user.email = email or user.email
        user.display_name = display_name or user.display_name
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def add_role(self, user: User, role_name: str) -> None:
        role = await self._get_role(role_name)

        existing = await self.session.scalar(
            select(UserRole.id).where(
                UserRole.user_id == user.id,
                UserRole.role_id == role.id,
            )
        )
        if existing:
            return

        self.session.add(UserRole(user_id=user.id, role_id=role.id))
        await self.session.flush()

    async def has_role(self, user: User, role_name: str) -> bool:
        return (
            await self.session.scalar(
                select(UserRole.id)
                .join(Role, Role.id == UserRole.role_id)
                .where(UserRole.user_id == user.id, Role.name == role_name)
            )
            is not None
        )

    async def list_role_names(self, user_id: str) -> list[str]:
        role_rows = await self.session.execute(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
        )
        return sorted(set(role_rows.scalars().all()))

    async def admin_exists(self) -> bool:
        stmt = (
            select(func.count(User.id))
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.name == ADMIN_ROLE)
        )
        count = await self.session.scalar(stmt)
        return bool(count and count > 0)

    async def _get_role(self, role_name: str) -> Role:
        role_result = await self.session.execute(
            select(Role).where(Role.name == role_name)
        )
        role = role_result.scalar_one_or_none()
        if role is None:
            role = Role(name=role_name)
            self.session.add(role)
            await self.session.flush()
        return role
