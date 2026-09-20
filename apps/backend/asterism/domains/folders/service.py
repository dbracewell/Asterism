import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException, UnauthorizedException
from asterism.db.database import get_async_db_session
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.schemas import ChatInfo

from .models import FolderModel
from .schemas import (
    FlatFolder,
    Folder,
    FolderChatList,
    FolderList,
    GetFolderRequest,
    NewFolderRequest,
)


async def create_folder(
    user_id: str,
    payload: NewFolderRequest,
    session: AsyncSession | None = None,
) -> Folder:
    async with get_async_db_session(session) as session:
        new_folder = FolderModel(
            user_id=user_id,
            title=payload.title,
            parent_id=payload.parent_id,
        )
        session.add(new_folder)
        await session.commit()
        return Folder.model_validate(new_folder)


async def delete_folder(
    user_id: str,
    folder_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> Folder:
    async with get_async_db_session(session) as session:
        folder = await session.get(FolderModel, folder_id)
        if folder is None:
            raise NotFoundException(f"Folder with id {folder_id} not found")
        if folder.user_id != user_id:
            raise UnauthorizedException()

        await session.delete(folder)
        await session.commit()
        return Folder.model_validate(folder)


async def _get_child_folders(
    user_id: str,
    parent_id: uuid.UUID,
    session: AsyncSession,
):
    stmt = select(FolderModel).where(
        FolderModel.user_id == user_id,
        FolderModel.parent_id == parent_id,
    )
    result = await session.scalars(stmt)
    return [Folder.model_validate(f) for f in result.all()]


async def _get_chat_sessions(
    user_id: str,
    folder_id: uuid.UUID,
    session: AsyncSession,
):
    stmt = (
        select(ChatModel)
        .where(
            ChatModel.user_id == user_id,
            ChatModel.folder_id == folder_id,
        )
        .order_by(ChatModel.updated_at.desc())
    )
    result = await session.scalars(stmt)
    return [ChatInfo.model_validate(r) for r in result.all()]


async def list_folder_chats(
    user_id: str,
    folder_id: uuid.UUID,
    page: int,
    page_size: int,
    session: AsyncSession | None = None,
) -> FolderChatList:
    async with get_async_db_session(session) as session:
        folder = await session.get(FolderModel, folder_id)
        if folder is None:
            raise NotFoundException()
        if folder.user_id != user_id:
            raise UnauthorizedException()
        where = (ChatModel.user_id == user_id, ChatModel.folder_id == folder_id)
        total = await session.scalar(select(func.count()).select_from(ChatModel).where(*where))
        chats = list(
            await session.scalars(
                select(ChatModel)
                .where(*where)
                .order_by(ChatModel.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        chat_infos = []
        for chat in chats:
            preview = await session.scalar(
                select(MessageModel.content)
                .where(MessageModel.chat_id == chat.id)
                .order_by(MessageModel.created_at.desc())
                .limit(1)
            )
            info = ChatInfo.model_validate(chat)
            info.preview = preview
            info.message_count = await session.scalar(
                select(func.count()).select_from(MessageModel).where(
                    MessageModel.chat_id == chat.id
                )
            )
            chat_infos.append(info)
        return FolderChatList(
            chats=chat_infos,
            total=total or 0,
            page=page,
            page_size=page_size,
        )


async def get_folder(
    user_id: str,
    payload: GetFolderRequest,
    session: AsyncSession | None = None,
) -> Folder:
    async with get_async_db_session(session) as session:
        folder = await session.get(FolderModel, payload.id)
        if folder is None:
            raise NotFoundException()
        if folder.user_id != user_id:
            raise UnauthorizedException()

        if not payload.include_children:
            return Folder.model_validate(folder)

        async def get_children(folder: Folder):
            folder.sessions = await _get_chat_sessions(
                user_id=user_id,
                folder_id=folder.id,
                session=session,
            )
            children = await _get_child_folders(
                user_id=user_id,
                parent_id=folder.id,
                session=session,
            )
            for child in children:
                await get_children(child)
                folder.children.append(child)
            folder.children.sort(key=lambda folder: folder.created_at)

        root = Folder.model_validate(folder)
        await get_children(root)
        return root


async def list_folders(
    user_id: str,
    session: AsyncSession | None = None,
) -> FolderList:
    async with get_async_db_session(session) as session:
        stmt = select(FolderModel).where(FolderModel.user_id == user_id)

        all_folders = (await session.scalars(stmt)).unique().all()
        flat_pydantic_folders = [
            FlatFolder.model_validate(f) for f in all_folders
        ]
        tree_folders = [Folder(**f.model_dump()) for f in flat_pydantic_folders]
        folder_map = {folder.id: folder for folder in tree_folders}
        root_folders = []

        for folder in tree_folders:
            folder.sessions = await _get_chat_sessions(
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

        return FolderList(folders=root_folders)
