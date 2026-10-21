"""FastAPI routes for the knowledge administration surfaces.

These endpoints keep their existing ``/settings/app/...`` URLs, operation ids,
and response shapes; only their owning module changes. The knowledge domain
owns the processing policy and the model bundles it depends on, so the admin
surfaces that configure them are served from here.

The router is registered on the application *before* the settings router so the
specific captioning and profile paths are matched before the generic
``/settings/app/{key}`` routes.
"""

import asyncio

from fastapi import APIRouter, HTTPException

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from .captioning import captioning_download_service
from .embedding import embedding_download_service
from .model_download import DownloadProgress
from .policy import get_captioning_configuration as load_captioning_configuration
from .processing import (
    update_captioning_configuration as apply_captioning_configuration,
)
from .processing import (
    update_processing_profile_and_reprocess,
)
from .processing_schemas import (
    KnowledgeCaptionConfiguration,
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeProcessingProfileUpdate,
    KnowledgeReprocessSummary,
)

knowledge_router = APIRouter(
    prefix="/settings",
    # The tag is the public API resource group, not the owning module: every
    # path here lives under /settings, and the OpenAPI tag must keep matching
    # its URL prefix. Owning the endpoints in the knowledge domain does not
    # change the surface they are published on.
    tags=["settings"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@knowledge_router.get(
    "/app/captioning",
    response_model=KnowledgeCaptionConfiguration,
    operation_id="appCaptioningGet",
    summary="Get image captioning configuration",
)
async def get_captioning_configuration(
    user: AdminUserDep,
    session: DBSessionDep,
) -> KnowledgeCaptionConfiguration:
    """Return the image captioning mode and selected provider model."""
    return await load_captioning_configuration(session=session)


@knowledge_router.put(
    "/app/captioning",
    response_model=KnowledgeCaptionConfiguration,
    operation_id="appCaptioningUpdate",
    summary="Set image captioning mode and selected provider model",
    responses={400: {"model": ErrorDetail}},
)
async def update_captioning_configuration(
    payload: KnowledgeCaptionConfigurationUpdate,
    user: AdminUserDep,
    session: DBSessionDep,
) -> KnowledgeCaptionConfiguration:
    """Set the image captioning mode and selected provider model."""
    return await apply_captioning_configuration(payload=payload, session=session)


@knowledge_router.put(
    "/app/knowledge-processing-profile",
    response_model=KnowledgeReprocessSummary,
    operation_id="appKnowledgeProcessingProfileUpdate",
)
async def update_knowledge_processing_profile(
    payload: KnowledgeProcessingProfileUpdate,
    user: AdminUserDep,
    session: DBSessionDep,
) -> KnowledgeReprocessSummary:
    """Update the knowledge processing profile and reprocess affected files."""
    return await update_processing_profile_and_reprocess(payload=payload, session=session)


@knowledge_router.get(
    "/app/knowledge-embedding/status",
    response_model=DownloadProgress,
    operation_id="appKnowledgeEmbeddingStatus",
    summary="Get automatic knowledge embedding bundle readiness",
)
async def get_knowledge_embedding_status(user: AdminUserDep) -> DownloadProgress:
    """Return the readiness/download progress of the knowledge embedding bundle."""
    return await asyncio.to_thread(embedding_download_service.progress)


@knowledge_router.get(
    "/app/caption-model/status",
    response_model=DownloadProgress,
    operation_id="appCaptionModelStatus",
    summary="Get local caption model download/readiness status",
)
async def get_caption_model_status(
    user: AdminUserDep,
) -> DownloadProgress:
    """Return the download/readiness progress of the local caption model."""
    return await asyncio.to_thread(captioning_download_service.progress)


@knowledge_router.post(
    "/app/caption-model/download",
    response_model=DownloadProgress,
    operation_id="appCaptionModelDownload",
    summary="Start downloading the local caption model",
    status_code=202,
    responses={
        409: {"description": "Download already in progress", "model": ErrorDetail},
    },
)
async def start_caption_model_download(
    user: AdminUserDep,
) -> DownloadProgress:
    """Start the local caption model download (409 if one is already running)."""
    try:
        return await captioning_download_service.start_download()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@knowledge_router.post(
    "/app/caption-model/cancel",
    response_model=DownloadProgress,
    operation_id="appCaptionModelCancel",
    summary="Cancel an active local caption model download",
)
async def cancel_caption_model_download(
    user: AdminUserDep,
) -> DownloadProgress:
    """Cancel an in-progress local caption model download."""
    return await captioning_download_service.cancel_download()
