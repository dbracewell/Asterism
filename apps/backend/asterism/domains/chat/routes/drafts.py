"""Draft routes: a new chat's draft, its model and its attached and uploaded files."""

import uuid
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from asterism.db.dependencies import DBSessionDep
from asterism.domains.files.schemas import UserFileList
from asterism.domains.user.dependencies import AuthedUserDep

from ..schemas import (
    ChatDraft,
    ChatDraftCreate,
    ChatDraftFiles,
    ChatDraftModelUpdate,
)

router = APIRouter()


@router.put("/drafts/{draft_id}/model", response_model=ChatDraft, operation_id="chatDraftModelUpdate")
async def select_draft_model(
    draft_id: uuid.UUID,
    payload: ChatDraftModelUpdate,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> ChatDraft:
    from ..drafts import change_draft_model

    return await change_draft_model(user_id=user.id, draft_id=draft_id, payload=payload, session=session)


@router.post("/drafts", response_model=ChatDraft, operation_id="chatDraftCreate")
async def create_draft(payload: ChatDraftCreate, user: AuthedUserDep, db: DBSessionDep) -> ChatDraft:
    from ..drafts import create_draft

    return await create_draft(user_id=user.id, payload=payload, session=db)


@router.get("/drafts/{draft_id}", response_model=ChatDraft, operation_id="chatDraftGetOne")
async def read_draft(draft_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> ChatDraft:
    from ..drafts import get_draft

    return await get_draft(user_id=user.id, draft_id=draft_id, session=db)


@router.delete("/drafts/{draft_id}", response_model=ChatDraft, operation_id="chatDraftDiscard")
async def discard_draft(draft_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> ChatDraft:
    from ..drafts import discard_draft

    return await discard_draft(user_id=user.id, draft_id=draft_id, session=db)


@router.post("/drafts/{draft_id}/files", response_model=ChatDraft, operation_id="chatDraftAddFiles")
async def add_draft_files(
    draft_id: uuid.UUID,
    payload: ChatDraftFiles,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatDraft:
    from ..drafts import change_draft_files

    return await change_draft_files(user_id=user.id, draft_id=draft_id, payload=payload, remove=False, session=db)


@router.delete("/drafts/{draft_id}/files", response_model=ChatDraft, operation_id="chatDraftRemoveFiles")
async def remove_draft_files(
    draft_id: uuid.UUID,
    payload: ChatDraftFiles,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatDraft:
    from ..drafts import change_draft_files

    return await change_draft_files(user_id=user.id, draft_id=draft_id, payload=payload, remove=True, session=db)


@router.post("/drafts/{draft_id}/uploads", response_model=UserFileList, operation_id="chatDraftUpload")
async def upload_draft_files(
    draft_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    files: Annotated[list[UploadFile], File(description="Stage uploaded library sources for this draft")],
) -> UserFileList:
    from asterism.domains.files.service import upload_files

    from ..drafts import change_draft_files, get_draft

    # Source ingestion commits independently; only an accepted message grants runtime access.
    # Revalidation after ingest covers cancellation/expiry while the upload was running.
    await get_draft(user_id=user.id, draft_id=draft_id, session=db)
    result = await upload_files(user_id=user.id, uploads=files, session=db)
    await change_draft_files(
        user_id=user.id,
        draft_id=draft_id,
        payload=ChatDraftFiles(file_ids=[file.id for file in result.files]),
        remove=False,
        session=db,
    )
    return result
