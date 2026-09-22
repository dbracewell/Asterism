"""Bounded, content-safe background caption generation jobs."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import select, update

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.files.models import UserFileModel

from .audit import record_knowledge_audit
from .captioning import CaptionErrorCode, CaptioningError, CaptionResult, bounded_caption
from .models import KnowledgeCaptionMode, KnowledgeCaptionStatus, KnowledgeDocumentModel

CaptionRunner = Callable[[KnowledgeDocumentModel, UserFileModel], Awaitable[CaptionResult]]
logger = logging.getLogger(__name__)

_SAFE_FAILURE_REASONS = {
    CaptionErrorCode.DISABLED: "Image captioning is disabled",
    CaptionErrorCode.INVALID_SELECTION: "Captioning configuration is invalid",
    CaptionErrorCode.NOT_READY: "Captioning runtime is not ready",
    CaptionErrorCode.ARTIFACT_MISSING: "Local caption model artifact is missing",
    CaptionErrorCode.ARTIFACT_INVALID: "Local caption model artifact verification failed",
    CaptionErrorCode.IMAGE_INVALID: "Image could not be captioned",
    CaptionErrorCode.OUTPUT_INVALID: "Caption generation returned no usable description",
    CaptionErrorCode.TIMEOUT: "Caption generation timed out",
    CaptionErrorCode.PROVIDER_FAILURE: "Caption generation failed",
}


class KnowledgeCaptionJobs:
    """One cancellable job per revision, with a strict timeout and concurrency limit.

    The runner must not log image data or generated text. This coordinator persists
    only bounded, safe state and content-free audit metadata.
    """

    def __init__(self, runner: CaptionRunner, *, max_concurrency: int = 1, timeout_seconds: float = 90) -> None:
        if max_concurrency < 1 or timeout_seconds <= 0:
            raise ValueError("caption job limits must be positive")
        self._runner = runner
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._timeout_seconds = timeout_seconds
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue(self, *, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID) -> bool:
        key = str(document_id)
        if key in self._tasks:
            return False
        task = asyncio.create_task(self._run(user_id, knowledge_base_id, document_id))
        self._tasks[key] = task
        task.add_done_callback(lambda _: self._tasks.pop(key, None))
        return True

    def cancel(self, document_id: str) -> bool:
        task = self._tasks.get(document_id)
        if task is None:
            return False
        task.cancel()
        return True

    async def _load(self, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID):
        async with get_async_db_session() as session:
            result = await session.execute(
                select(KnowledgeDocumentModel, UserFileModel)
                .join(UserFileModel, KnowledgeDocumentModel.file_id == UserFileModel.id)
                .where(
                    KnowledgeDocumentModel.id == document_id,
                    KnowledgeDocumentModel.user_id == user_id,
                    KnowledgeDocumentModel.knowledge_base_id == knowledge_base_id,
                )
            )
            return result.one_or_none()

    async def _run(self, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID) -> None:
        async with self._semaphore:
            loaded = await self._load(user_id, knowledge_base_id, document_id)
            if loaded is None:
                return
            document, file = loaded
            await self._mark_running(document_id, user_id, knowledge_base_id)
            try:
                result = await asyncio.wait_for(self._runner(document, file), timeout=self._timeout_seconds)
                result = CaptionResult(
                    text=bounded_caption(result.text, config.max_caption_chars),
                    source=result.source,
                    model=result.model,
                )
            except asyncio.CancelledError:
                await self._mark_failed(document_id, user_id, knowledge_base_id, "canceled", CaptionErrorCode.DISABLED)
                raise
            except asyncio.TimeoutError:
                await self._mark_failed(document_id, user_id, knowledge_base_id, "failed", CaptionErrorCode.TIMEOUT)
            except CaptioningError as error:
                logger.warning(
                    "Knowledge caption generation failed: %s",
                    error.code.value,
                    extra={"knowledge_document_id": str(document_id), "knowledge_base_id": str(knowledge_base_id)},
                )
                await self._mark_failed(document_id, user_id, knowledge_base_id, "failed", error.code)
            except Exception:
                logger.exception(
                    "Knowledge caption generation failed unexpectedly",
                    extra={"knowledge_document_id": str(document_id), "knowledge_base_id": str(knowledge_base_id)},
                )
                await self._mark_failed(
                    document_id, user_id, knowledge_base_id, "failed", CaptionErrorCode.PROVIDER_FAILURE
                )
            else:
                await self._mark_draft(document_id, user_id, knowledge_base_id, result)

    async def _mark_running(self, document_id: uuid.UUID, user_id: str, knowledge_base_id: uuid.UUID) -> None:
        async with get_async_db_session() as session:
            document = await session.get(KnowledgeDocumentModel, document_id)
            if document is None or document.user_id != user_id or document.knowledge_base_id != knowledge_base_id:
                return
            document.caption_status = KnowledgeCaptionStatus.RUNNING
            document.caption_error_code = None
            document.caption_error_reason = None
            session.add(
                record_knowledge_audit(
                    user_id=user_id,
                    action="caption.started",
                    knowledge_base_id=knowledge_base_id,
                    document_id=document_id,
                )
            )
            await session.commit()

    async def _mark_failed(
        self, document_id: uuid.UUID, user_id: str, knowledge_base_id: uuid.UUID, action: str, code: CaptionErrorCode
    ) -> None:
        async with get_async_db_session() as session:
            document = await session.get(KnowledgeDocumentModel, document_id)
            if document is None or document.user_id != user_id or document.knowledge_base_id != knowledge_base_id:
                return
            document.caption_status = (
                KnowledgeCaptionStatus.CANCELED if action == "canceled" else KnowledgeCaptionStatus.FAILED
            )
            document.caption_error_code = code.value
            document.caption_error_reason = (
                "Caption generation was canceled"
                if action == "canceled"
                else _SAFE_FAILURE_REASONS.get(code, "Caption generation failed")
            )
            session.add(
                record_knowledge_audit(
                    user_id=user_id,
                    action=f"caption.{action}",
                    knowledge_base_id=knowledge_base_id,
                    document_id=document_id,
                    details={"code": code.value},
                )
            )
            await session.commit()

    async def _mark_draft(
        self, document_id: uuid.UUID, user_id: str, knowledge_base_id: uuid.UUID, result: CaptionResult
    ) -> None:
        async with get_async_db_session() as session:
            document = await session.get(KnowledgeDocumentModel, document_id)
            if document is None or document.user_id != user_id or document.knowledge_base_id != knowledge_base_id:
                return
            document.caption_status = KnowledgeCaptionStatus.DRAFT
            document.caption_source = KnowledgeCaptionMode(result.source.value)
            document.caption_model = result.model[:512]
            document.caption_text = result.text
            document.caption_error_code = None
            document.caption_error_reason = None
            document.caption_generated_at = get_unix_timestamp()
            session.add(
                record_knowledge_audit(
                    user_id=user_id,
                    action=f"caption.{result.source.value}_drafted",
                    knowledge_base_id=knowledge_base_id,
                    document_id=document_id,
                    details={"model": result.model[:128]},
                )
            )
            await session.commit()

    async def recover_interrupted(self) -> None:
        """Make captions interrupted by restart explicitly retryable."""
        async with get_async_db_session() as session:
            await session.execute(
                update(KnowledgeDocumentModel)
                .where(KnowledgeDocumentModel.caption_status == KnowledgeCaptionStatus.RUNNING)
                .values(
                    caption_status=KnowledgeCaptionStatus.FAILED,
                    caption_error_code=CaptionErrorCode.TIMEOUT.value,
                    caption_error_reason="Caption generation interrupted by restart",
                )
            )
            await session.commit()

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
