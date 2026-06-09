import uuid

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from asterism.models.folder import Folder
from asterism.schemas.folders import (
    FolderListResponse,
    FolderResponse,
    FolderResponseFlat,
)


class FolderRepository:
    def __init__(self, db_session: AsyncSession):
        self.session = db_session

    async def create_folder(
        self, user_id: str, folder_title: str, parent_folder_id: uuid.UUID | None
    ) -> FolderResponse:
        new_folder = Folder(
            user_id=user_id,
            title=folder_title,
            parent_folder_id=parent_folder_id,
        )
        self.session.add(new_folder)
        await self.session.commit()
        return FolderResponse(
            id=new_folder.id,
            title=new_folder.title,
            parent_folder_id=parent_folder_id,
        )

    async def delete_folder(self, user_id: str, folder_id: uuid.UUID) -> str:
        folder = await self.session.get(Folder, folder_id)
        if folder is None:
            return "404"
        if folder.user_id != user_id:
            return "401"
        await self.session.delete(folder)
        await self.session.commit()
        state = inspect(folder)
        return "success" if state.deleted else "500"

    async def list_folders(self, user_id: str) -> FolderListResponse:
        stmt = (
            select(Folder)
            .where(Folder.user_id == user_id)
            .options(selectinload(Folder.sessions))
        )

        all_folders = (await self.session.scalars(stmt)).unique().all()
        flat_pydantic_folders = [
            FolderResponseFlat.model_validate(f) for f in all_folders
        ]
        tree_folders = [FolderResponse(**f.model_dump()) for f in flat_pydantic_folders]
        folder_map = {folder.id: folder for folder in tree_folders}
        root_folders = []

        for folder in tree_folders:
            if folder.parent_folder_id is None:
                root_folders.append(folder)
            else:
                parent = folder_map.get(folder.parent_folder_id)
                if parent:
                    parent.children.append(folder)

        return FolderListResponse(root=root_folders)
