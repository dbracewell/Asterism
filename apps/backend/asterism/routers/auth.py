import secrets

from fastapi import APIRouter, HTTPException, status

from asterism.config import config
from asterism.internal.db import DBSessionDep
from asterism.repositories.user_repository import ADMIN_ROLE, UserRepository
from asterism.routers.base import CurrentAdminUser, CurrentUser
from asterism.routers.typedefs import ErrorDetail
from asterism.schemas.auth import (
    BootstrapAdminRequest,
    BootstrapAdminResponse,
    SetupStatusResponse,
    UserMeResponse,
)


auth_router = APIRouter(
    prefix="/api/auth",
    tags=["auth"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)

setup_router = APIRouter(
    prefix="/api/setup",
    tags=["setup"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)

admin_router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@auth_router.get(
    "/me",
    operation_id="getCurrentUser",
    responses={
        200: {"model": UserMeResponse},
        401: {"model": ErrorDetail},
    },
)
async def get_current_user(
    user: CurrentUser,
    session: DBSessionDep,
) -> UserMeResponse:
    user_repo = UserRepository(session)
    return UserMeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=await user_repo.list_role_names(user.id),
    )


@setup_router.get(
    "/status",
    operation_id="getSetupStatus",
    responses={
        200: {"model": SetupStatusResponse},
        401: {"model": ErrorDetail},
    },
)
async def get_setup_status(
    user: CurrentUser,
    session: DBSessionDep,
) -> SetupStatusResponse:
    user_repo = UserRepository(session)
    admin_exists = await user_repo.admin_exists()

    return SetupStatusResponse(
        requires_setup=not admin_exists,
        is_current_user_admin=await user_repo.has_role(user, ADMIN_ROLE),
    )


@setup_router.post(
    "/bootstrap-admin",
    operation_id="bootstrapAdmin",
    responses={
        200: {"model": BootstrapAdminResponse},
        401: {"model": ErrorDetail},
        403: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
        503: {"model": ErrorDetail},
    },
)
async def bootstrap_admin(
    body: BootstrapAdminRequest,
    user: CurrentUser,
    session: DBSessionDep,
) -> BootstrapAdminResponse:
    setup_token = config.BOOTSTRAP_SETUP_TOKEN
    if not setup_token:
        raise HTTPException(status_code=503, detail="Setup token is not configured")

    if not secrets.compare_digest(body.setup_token, setup_token):
        raise HTTPException(status_code=403, detail="Invalid setup token")

    user_repo = UserRepository(session)
    if await user_repo.admin_exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin user is already configured",
        )

    await user_repo.add_role(user, ADMIN_ROLE)
    await session.commit()
    await session.refresh(user)

    return BootstrapAdminResponse(
        id=user.id,
        roles=await user_repo.list_role_names(user.id),
    )


@admin_router.get(
    "/ping",
    operation_id="adminPing",
    responses={
        200: {
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {"status": {"type": "string"}},
                    }
                }
            }
        },
        401: {"model": ErrorDetail},
        403: {"model": ErrorDetail},
    },
)
async def admin_ping(_admin: CurrentAdminUser):
    return {"status": "ok"}
