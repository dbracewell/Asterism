"""Admin image generation policy and the user's availability (ADR-0064)."""

from fastapi import APIRouter

from asterism.common.log import get_logger
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from . import policy
from .schemas import ImageGenerationAvailability, ImageGenerationPolicy, ImageProviderStatus

image_generation_router = APIRouter(
    tags=["image-generation"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 403: {"model": ErrorDetail}},
)
logger = get_logger("ImageGeneration")


@image_generation_router.get("/settings/app/image-generation", operation_id="imageGenerationPolicyGet")
async def get_policy(user: AdminUserDep, session: DBSessionDep) -> ImageGenerationPolicy:
    return await policy.read_policy(session)


@image_generation_router.put("/settings/app/image-generation", operation_id="imageGenerationPolicyUpdate")
async def put_policy(
    payload: ImageGenerationPolicy, user: AdminUserDep, session: DBSessionDep
) -> ImageGenerationPolicy:
    result = await policy.write_policy(payload, session)
    logger.info(
        f"Image generation policy set by admin {user.id}: enabled={result.enabled} "
        f"provider={result.provider} groups={result.group_ids}"
    )
    return result


@image_generation_router.get("/settings/app/image-generation/status", operation_id="imageGenerationProviderStatus")
async def get_status(user: AdminUserDep, session: DBSessionDep) -> ImageProviderStatus:
    return await policy.provider_status(await policy.read_policy(session), session)


@image_generation_router.get("/image-generation/availability", operation_id="imageGenerationAvailability")
async def get_availability(user: AuthedUserDep, session: DBSessionDep) -> ImageGenerationAvailability:
    """Whether you can create images now; the reason is shown when you can't."""
    return await policy.availability(user.id, session)
