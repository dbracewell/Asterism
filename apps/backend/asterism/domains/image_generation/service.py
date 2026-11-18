"""Run one image generation: check, queue, generate, save to the user's files, record (ADR-0064).

Database sessions are short: checks, then generation with no session open,
then saving. A generation can take minutes and must not hold a connection.
"""

import asyncio
import io
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException
from asterism.domains.usage.schemas import UsageMeter, UsageSource
from asterism.domains.usage.service import record_usage, require_within_budget

from .models import ImageGenerationModel
from .policy import require_available
from .providers import ImageGenerationError, ImageGeneratorComponent, load_generator, selected_name
from .safety import refusal_reason
from .schemas import (
    DEFAULT_TIMEOUT_SECONDS,
    GeneratedImage,
    ImageGenerationStatus,
    ImageProgress,
    ImageRequest,
    ProviderImage,
)

if TYPE_CHECKING:
    from asterism.domains.agent.execution_scope import ExecutionScope

logger = get_logger("ImageGeneration")

# One job at a time per provider by default; a local GPU runs one pipeline.
_SLOTS: dict[str, asyncio.Semaphore] = {}

Progress = Callable[[ImageProgress], Awaitable[None]]


async def _no_progress(_: ImageProgress) -> None:
    return None


def _slot(provider: str) -> asyncio.Semaphore:
    return _SLOTS.setdefault(provider, asyncio.Semaphore(1))


def _filename(prompt: str, seed: int) -> str:
    words = re.sub(r"[^A-Za-z0-9]+", " ", prompt).split()[:6]
    return f"{'-'.join(words).lower()[:60] or 'image'}-{seed}.png"


def _clean_png(image: ProviderImage) -> bytes:
    """Re-encode as a plain PNG: verifies it is an image and drops embedded metadata."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(image.png)) as opened:
            opened.verify()
        with Image.open(io.BytesIO(image.png)) as opened:
            out = io.BytesIO()
            opened.convert("RGBA" if "A" in opened.getbands() else "RGB").save(out, format="PNG")
            return out.getvalue()
    except Exception as exc:
        raise ImageGenerationError("The image provider returned something that isn't an image") from exc


async def _record(
    *,
    user_id: str,
    chat_id: uuid.UUID | None,
    request: ImageRequest,
    provider: str,
    status: ImageGenerationStatus,
    started: float,
    model: str = "",
    revision: str = "",
    steps: int | None = None,
    error: str = "",
    images: list[dict] | None = None,
) -> None:
    from asterism.db.database import get_async_db_session

    async with get_async_db_session() as session:
        session.add(
            ImageGenerationModel(
                user_id=user_id,
                chat_id=chat_id,
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                provider=provider,
                model=model,
                revision=revision,
                width=request.width,
                height=request.height,
                count=request.count,
                steps=steps if steps is not None else request.steps,
                status=status,
                error=error[:2000],
                images=images or [],
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        )
        await session.commit()
    logger.info(f"Image generation {status} for user {user_id} in chat {chat_id} via {provider}")


async def _refuse_unsafe(user_id: str, chat_id: uuid.UUID | None, request: ImageRequest, started: float) -> None:
    """The fixed prompt check, recorded before anything else so every refusal is audited."""
    from asterism.db.database import get_async_db_session

    if reason := refusal_reason(request.prompt, request.negative_prompt):
        async with get_async_db_session() as session:
            provider_name = await selected_name(session)
        await _record(
            user_id=user_id,
            chat_id=chat_id,
            request=request,
            provider=provider_name,
            status="refused",
            started=started,
            error=reason,
        )
        raise BadDataException(reason)


async def generate_images(
    *,
    user_id: str,
    chat_id: uuid.UUID | None,
    request: ImageRequest,
    progress: Progress = _no_progress,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    scope: "ExecutionScope | None" = None,
) -> list[GeneratedImage]:
    """Generate, save each image and return the saved files.

    In a chat run (``scope``), images are produced files of that run: they join
    the chat on its branch and render inline from their embeds (ADR-0039).
    Without a run they go straight to the user's library.
    """
    from asterism.db.database import get_async_db_session

    started = time.monotonic()
    await _refuse_unsafe(user_id, chat_id, request, started)
    async with get_async_db_session() as session:
        await require_available(user_id, session)
        # Images use no tokens, but a user over budget gets no new generation work (ADR-0073).
        await require_within_budget(user_id, session)
        provider = await load_generator(session)
    if provider is None:
        raise BadDataException("No image provider is set up")
    return await _run(provider, user_id, chat_id, request, progress, timeout, scope, started)


async def run_test_generation(*, admin_id: str, request: ImageRequest) -> list[GeneratedImage]:
    """An administrator tries the configured generator; the images go to their library.

    This works while the policy is off, so a generator can be tried before it
    is switched on for users. The prompt check, the queue, the audit record and
    the generator's own readiness still apply.
    """
    from asterism.db.database import get_async_db_session

    started = time.monotonic()
    await _refuse_unsafe(admin_id, None, request, started)
    async with get_async_db_session() as session:
        provider = await load_generator(session)
    if provider is None:
        raise BadDataException("No image provider is set up")
    status = await provider.status()
    if not status.ready:
        raise BadDataException(status.detail or "The image provider isn't ready")
    return await _run(provider, admin_id, None, request, _no_progress, DEFAULT_TIMEOUT_SECONDS, None, started)


async def _run(
    provider: ImageGeneratorComponent,
    user_id: str,
    chat_id: uuid.UUID | None,
    request: ImageRequest,
    progress: Progress,
    timeout: float,
    scope: "ExecutionScope | None",
    started: float,
) -> list[GeneratedImage]:
    """One queued job on a ready generator: generate, clean, save and record."""
    slot = _slot(provider.name)
    await progress(ImageProgress(stage="queued"))
    try:
        async with slot:
            await progress(ImageProgress(stage="running", step=0, total=request.steps))
            result = await asyncio.wait_for(provider(request, progress), timeout)
            if not result.images:
                raise ImageGenerationError("The image provider returned no images")
            await progress(ImageProgress(stage="saving"))
            pngs = [(_clean_png(image), image) for image in result.images[: request.count]]
    except asyncio.CancelledError:
        await asyncio.shield(
            _record(
                user_id=user_id,
                chat_id=chat_id,
                request=request,
                provider=provider.name,
                status="cancelled",
                started=started,
            )
        )
        raise
    except (ImageGenerationError, TimeoutError) as exc:
        message = str(exc) if isinstance(exc, ImageGenerationError) else "Image generation timed out"
        await _record(
            user_id=user_id,
            chat_id=chat_id,
            request=request,
            provider=provider.name,
            status="failed",
            started=started,
            error=message,
        )
        raise BadDataException(message) from exc
    except Exception as exc:
        logger.exception("Image provider %s failed", provider.name)
        await _record(
            user_id=user_id,
            chat_id=chat_id,
            request=request,
            provider=provider.name,
            status="failed",
            started=started,
            error=f"{type(exc).__name__}: {exc}",
        )
        raise BadDataException("Image generation failed; try again or ask an administrator") from exc

    try:
        saved = (
            await _save_produced(scope, request.prompt, result.model, pngs)
            if scope is not None
            else await _save(user_id, request.prompt, result.model, pngs)
        )
    except BadDataException as exc:
        await _record(
            user_id=user_id,
            chat_id=chat_id,
            request=request,
            provider=provider.name,
            status="failed",
            started=started,
            model=result.model,
            error=str(exc),
        )
        raise
    await _record(
        user_id=user_id,
        chat_id=chat_id,
        request=request,
        provider=provider.name,
        status="completed",
        started=started,
        model=result.model,
        revision=result.revision,
        steps=result.steps,
        images=[{"file_id": str(image.file_id), "seed": image.seed} for image in saved],
    )
    await record_usage(
        UsageMeter(
            user_id=user_id,
            source=UsageSource.IMAGE,
            model_id=None,
            model_name=f"{provider.name}: {result.model}" if result.model else provider.name,
            chat_id=chat_id,
        ),
        images=len(saved),
    )
    return saved


def _embed(file_id: uuid.UUID, filename: str) -> str:
    from asterism.domains.files.produced import file_reference_token

    label = re.sub(r"[\[\]\\\r\n]", "", filename)[:200]
    return f"![{label}]({file_reference_token(file_id)})"


async def _save_produced(
    scope: "ExecutionScope", prompt: str, model: str, pngs: list[tuple[bytes, ProviderImage]]
) -> list[GeneratedImage]:
    from asterism.domains.files.produced import register_produced_file

    saved = []
    for data, image in pngs:
        file = await register_produced_file(
            scope, tool="generate_image", name=_filename(prompt, image.seed), content=data
        )
        saved.append(
            GeneratedImage(
                file_id=file.file_id,
                filename=file.filename,
                width=image.width,
                height=image.height,
                seed=image.seed,
                model=model,
                prompt=prompt,
                embed=file.embed,
            )
        )
    return saved


async def _save(user_id: str, prompt: str, model: str, pngs: list[tuple[bytes, ProviderImage]]) -> list[GeneratedImage]:
    from asterism.db.database import get_async_db_session
    from asterism.domains.files.service import new_library_file, start_file_ingestion
    from asterism.domains.files.store import get_file_store

    created = []
    async with get_async_db_session() as session:
        try:
            for data, image in pngs:
                created.append(
                    (
                        await new_library_file(
                            user_id=user_id,
                            original_name=_filename(prompt, image.seed),
                            content=data,
                            session=session,
                        ),
                        image,
                    )
                )
            await session.commit()
        except (Exception, asyncio.CancelledError):
            await session.rollback()
            for file, _ in created:
                get_file_store().delete(user_id, file.storage_key)
            raise
    for file, _ in created:
        start_file_ingestion(file)
    return [
        GeneratedImage(
            file_id=file.model.id,
            filename=file.model.filename,
            width=image.width,
            height=image.height,
            seed=image.seed,
            model=model,
            prompt=prompt,
            embed=_embed(file.model.id, file.model.filename),
        )
        for file, image in created
    ]
