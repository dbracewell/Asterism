"""HTTP surface for educator access and classes."""

import uuid

from fastapi import APIRouter, Query, status

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from . import educators, invites, service
from .schemas import (
    ClassCreate,
    ClassInviteCreate,
    ClassInvitePage,
    ClassJoinRequest,
    ClassMemberPage,
    ClassModePolicy,
    ClassUpdate,
    CreatedClassInviteList,
    EducatorAccess,
    EducatorRequest,
    EducatorRequestPage,
    InsightsConsent,
    InviteCheckRequest,
    InvitePreview,
    InviteRedeemRequest,
    JoinedClass,
    JoinedClassPage,
    TaughtClass,
    TaughtClassPage,
)

ERRORS = {
    400: {"model": ErrorDetail},
    401: {"model": ErrorDetail},
    403: {"model": ErrorDetail},
    404: {"model": ErrorDetail},
    409: {"model": ErrorDetail},
}
PageNumber = Query(default=1, ge=1)
PageSize = Query(default=50, ge=1, le=100)

educator_access_router = APIRouter(prefix="/educator-access", tags=["classes"], responses=ERRORS)
classes_router = APIRouter(prefix="/classes", tags=["classes"], responses=ERRORS)
# Server-to-server: called by the signup flow with the system key, not a JWT.
class_invites_router = APIRouter(prefix="/class-invites", tags=["classes"], responses=ERRORS)


@educator_access_router.get("", response_model=EducatorAccess, operation_id="educatorAccessGet")
async def get_access(user: AuthedUserDep, db: DBSessionDep) -> EducatorAccess:
    return await educators.read_access(user.id, db)


@educator_access_router.post("", response_model=EducatorAccess, operation_id="educatorAccessRequest")
async def request_access(user: AuthedUserDep, db: DBSessionDep) -> EducatorAccess:
    """Ask an administrator for educator access. Sends your name and email."""
    return await educators.request_access(user, db)


@educator_access_router.get("/requests", response_model=EducatorRequestPage, operation_id="educatorRequestGetMany")
async def list_requests(
    user: AdminUserDep, db: DBSessionDep, page: int = PageNumber, page_size: int = PageSize
) -> EducatorRequestPage:
    return await educators.list_requests(db, page=page, page_size=page_size)


@educator_access_router.post(
    "/requests/{user_id}/approve", response_model=EducatorRequest, operation_id="educatorRequestApprove"
)
async def approve_request(user_id: str, user: AdminUserDep, db: DBSessionDep) -> EducatorRequest:
    return await educators.approve(user_id=user_id, admin_id=user.id, session=db)


@educator_access_router.delete(
    "/requests/{user_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="educatorRequestDelete"
)
async def delete_request(user_id: str, user: AdminUserDep, db: DBSessionDep) -> None:
    """Deny a request or revoke access."""
    await educators.remove(user_id=user_id, admin_id=user.id, session=db)


# Static student routes come before /{class_id}.
@classes_router.post("/join", response_model=JoinedClass, operation_id="classJoin")
async def join_class(payload: ClassJoinRequest, user: AuthedUserDep, db: DBSessionDep) -> JoinedClass:
    """Join with a code. Your display name is shared with the educator."""
    return await service.join_class(user, payload.code, db)


@classes_router.get("/joined", response_model=JoinedClassPage, operation_id="classJoinedGetMany")
async def list_joined(
    user: AuthedUserDep, db: DBSessionDep, page: int = PageNumber, page_size: int = PageSize
) -> JoinedClassPage:
    return await service.list_joined(user.id, db, page=page, page_size=page_size)


@classes_router.put(
    "/joined/{class_id}/insights-consent", response_model=JoinedClass, operation_id="classInsightsConsentUpdate"
)
async def set_insights_consent(
    class_id: uuid.UUID, payload: InsightsConsent, user: AuthedUserDep, db: DBSessionDep
) -> JoinedClass:
    """Share, or stop sharing, your practice results in class-wide totals."""
    return await service.set_insights_consent(user.id, class_id, payload.consent, db)


@classes_router.delete("/joined/{class_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="classLeave")
async def leave_class(class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> None:
    await service.leave_class(user.id, class_id, db)


@classes_router.post("", response_model=TaughtClass, status_code=status.HTTP_201_CREATED, operation_id="classCreate")
async def create_class(payload: ClassCreate, user: AuthedUserDep, db: DBSessionDep) -> TaughtClass:
    return await service.create_class(user, payload, db)


@classes_router.get("", response_model=TaughtClassPage, operation_id="classGetMany")
async def list_taught(
    user: AuthedUserDep, db: DBSessionDep, page: int = PageNumber, page_size: int = PageSize
) -> TaughtClassPage:
    return await service.list_taught(user.id, db, page=page, page_size=page_size)


@classes_router.get("/{class_id}", response_model=TaughtClass, operation_id="classGetOne")
async def get_class(class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> TaughtClass:
    return await service.read_taught(user.id, class_id, db)


@classes_router.patch("/{class_id}", response_model=TaughtClass, operation_id="classUpdate")
async def update_class(class_id: uuid.UUID, payload: ClassUpdate, user: AuthedUserDep, db: DBSessionDep) -> TaughtClass:
    return await service.update_class(user.id, class_id, payload, db)


@classes_router.delete("/{class_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="classDelete")
async def delete_class(class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> None:
    await service.delete_class(user.id, class_id, db)


@classes_router.put("/{class_id}/mode-policy", response_model=TaughtClass, operation_id="classModePolicyUpdate")
async def set_mode_policy(
    class_id: uuid.UUID, payload: ClassModePolicy, user: AuthedUserDep, db: DBSessionDep
) -> TaughtClass:
    """Limit learning modes and answer reveal in students' course projects."""
    return await service.set_mode_policy(user.id, class_id, payload, db)


@classes_router.post("/{class_id}/join-code", response_model=TaughtClass, operation_id="classJoinCodeRotate")
async def rotate_join_code(class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> TaughtClass:
    """Replace the code. The old one stops working; members stay."""
    return await service.rotate_join_code(user.id, class_id, db)


@classes_router.get("/{class_id}/members", response_model=ClassMemberPage, operation_id="classMemberGetMany")
async def list_members(
    class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep, page: int = PageNumber, page_size: int = PageSize
) -> ClassMemberPage:
    return await service.list_members(user.id, class_id, db, page=page, page_size=page_size)


@classes_router.delete(
    "/{class_id}/members/{student_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="classMemberRemove"
)
async def remove_member(class_id: uuid.UUID, student_id: str, user: AuthedUserDep, db: DBSessionDep) -> None:
    await service.remove_member(user.id, class_id, student_id, db)


@classes_router.delete(
    "/{class_id}/members/{student_id}/removal",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="classMemberAllowBack",
)
async def allow_back(class_id: uuid.UUID, student_id: str, user: AuthedUserDep, db: DBSessionDep) -> None:
    """Let a removed student rejoin with the class code."""
    await service.allow_back(user.id, class_id, student_id, db)


@classes_router.post(
    "/{class_id}/invites",
    response_model=CreatedClassInviteList,
    status_code=status.HTTP_201_CREATED,
    operation_id="classInviteCreate",
)
async def create_invites(
    class_id: uuid.UUID, payload: ClassInviteCreate, user: AuthedUserDep, db: DBSessionDep
) -> CreatedClassInviteList:
    """Create one single-use invite per label. Each link is shown only in this response."""
    return await invites.create_invites(user.id, class_id, payload.labels, db)


@classes_router.get("/{class_id}/invites", response_model=ClassInvitePage, operation_id="classInviteGetMany")
async def list_invites(
    class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep, page: int = PageNumber, page_size: int = PageSize
) -> ClassInvitePage:
    return await invites.list_invites(user.id, class_id, db, page=page, page_size=page_size)


@classes_router.delete(
    "/{class_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="classInviteRevoke"
)
async def revoke_invite(class_id: uuid.UUID, invite_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> None:
    await invites.revoke_invite(user.id, class_id, invite_id, db)


@class_invites_router.post("/check", response_model=InvitePreview, operation_id="classInviteCheck")
async def check_invite(payload: InviteCheckRequest, db: DBSessionDep) -> InvitePreview:
    invites.require_system_key(payload.system_key)
    return await invites.check_invite(payload.token, db)


@class_invites_router.post("/redeem", response_model=InvitePreview, operation_id="classInviteRedeem")
async def redeem_invite(payload: InviteRedeemRequest, db: DBSessionDep) -> InvitePreview:
    invites.require_system_key(payload.system_key)
    return await invites.redeem_invite(
        payload.token,
        user_id=payload.user_id,
        display_name=payload.display_name,
        email=payload.email,
        session=db,
    )
