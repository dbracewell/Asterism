import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from asterism.core.data import get_async_db_session
from asterism.core.exceptions import NotFoundException, UnauthorizedException
from asterism.core.models import ChatSession
from asterism.core.models.chat_session import ChatSessionInfo
from asterism.core.models.folder import (
    FlatFolderModel,
    Folder,
    FolderModel,
    FolderModelList,
    GetFolderRequest,
    NewFolderRequest,
)


class FolderRepository:
    async def create_folder(
        self,
        user_id: str,
        payload: NewFolderRequest,
        session: AsyncSession | None = None,
    ) -> FolderModel:
        async with get_async_db_session(session) as session:
            new_folder = Folder(
                user_id=user_id,
                title=payload.title,
                parent_id=payload.parent_id,
            )
            session.add(new_folder)
            await session.commit()
            return FolderModel.model_validate(new_folder)

    async def delete_folder(
        self,
        user_id: str,
        folder_id: uuid.UUID,
        session: AsyncSession | None = None,
    ) -> FolderModel:
        async with get_async_db_session(session) as session:
            folder = await session.get(Folder, folder_id)
            if folder is None:
                raise NotFoundException()
            if folder.user_id != user_id:
                raise UnauthorizedException()

            await session.delete(folder)
            await session.commit()
            return FolderModel.model_validate(folder)

    async def _get_child_folders(
        self,
        user_id: str,
        parent_id: uuid.UUID,
        session: AsyncSession,
    ):
        stmt = select(Folder).where(
            Folder.user_id == user_id,
            Folder.parent_id == parent_id,
        )
        result = await session.scalars(stmt)
        return result.all()

    async def _get_chat_sessions(
        self,
        user_id: str,
        folder_id: uuid.UUID,
        session: AsyncSession,
    ):
        stmt = (
            select(ChatSession)
            .where(
                ChatSession.user_id == user_id,
                ChatSession.folder_id == folder_id,
            )
            .order_by(ChatSession.updated_at.desc())
        )
        result = await session.scalars(stmt)
        return [ChatSessionInfo.model_validate(r) for r in result.all()]

    async def get_folder(
        self,
        user_id: str,
        payload: GetFolderRequest,
        session: AsyncSession | None = None,
    ) -> FolderModel:
        async with get_async_db_session(session) as session:
            folder = await session.get(Folder, payload.id)
            if folder is None:
                raise NotFoundException()
            if folder.user_id != user_id:
                raise UnauthorizedException()

            if not payload.include_children:
                return FolderModel.model_validate(folder)

            async def get_children(folder: FolderModel):
                folder.sessions = await self._get_chat_sessions(
                    user_id=user_id,
                    folder_id=folder.id,
                    session=session,
                )
                children = await self._get_child_folders(
                    user_id=user_id,
                    parent_id=folder.id,
                    session=session,
                )
                for child in children:
                    await get_children(child)
                    folder.children.append(child)
                folder.children.sort(key=lambda folder: folder.created_at)

            root = FolderModel.model_validate(folder)
            await get_children(root)
            return root

    async def list_folders(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> FolderModelList:
        async with get_async_db_session(session) as session:
            stmt = select(Folder).where(Folder.user_id == user_id)

            all_folders = (await session.scalars(stmt)).unique().all()
            flat_pydantic_folders = [
                FlatFolderModel.model_validate(f) for f in all_folders
            ]
            tree_folders = [
                FolderModel(**f.model_dump()) for f in flat_pydantic_folders
            ]
            folder_map = {folder.id: folder for folder in tree_folders}
            root_folders = []

            for folder in tree_folders:
                folder.sessions = await self._get_chat_sessions(
                    user_id=user_id,
                    folder_id=folder.id,
                    session=session,
                )
                if folder.parent_id is None:
                    root_folders.append(folder)
                else:
                    parent = folder_map.get(folder.parent_id)
                    if parent:
                        parent.children.append(folder)

            return FolderModelList(folders=root_folders)


folder_repository = FolderRepository()
