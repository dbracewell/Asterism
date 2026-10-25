"""Authenticated private CRUD, main-agent assignments, and admin activation policy."""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.common.log import get_logger
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from . import assignments, policy, service
from .schemas import (
    MAX_REVISION,
    EligibleSkillsPage,
    Skill,
    SkillAssignments,
    SkillAssignmentUpdate,
    SkillCreate,
    SkillPage,
    SkillPolicy,
    SkillUpdate,
)

skills_router = APIRouter(
    tags=["skills"],
    responses={
        400: {"model": ErrorDetail},
        401: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
    },
)
logger = get_logger("SkillsPolicy")


@skills_router.get("/settings/app/skills", operation_id="skillsPolicyGet")
async def get_policy(user: AdminUserDep, session: DBSessionDep) -> SkillPolicy:
    return await policy.read_policy(session)


@skills_router.put("/settings/app/skills", operation_id="skillsPolicyUpdate")
async def put_policy(payload: SkillPolicy, user: AdminUserDep, session: DBSessionDep) -> SkillPolicy:
    result = await policy.write_policy(payload, session)
    logger.info(f"Skills activation policy set to {result.enabled} by admin {user.id}")
    return result


@skills_router.get("/settings/user/main-agent/skills", operation_id="mainAgentSkillsGet")
async def get_assignments(user: AuthedUserDep, session: DBSessionDep) -> SkillAssignments:
    return await assignments.read_assignments(user.id, session)


@skills_router.put("/settings/user/main-agent/skills", operation_id="mainAgentSkillsUpdate")
async def put_assignments(
    payload: SkillAssignmentUpdate, user: AuthedUserDep, session: DBSessionDep
) -> SkillAssignments:
    return await assignments.replace_assignments(user.id, payload, session)


# Static discovery must precede /skills/{skill_id}.
@skills_router.get("/skills/eligible", operation_id="skillEligibleGetMany")
async def eligible(
    user: AuthedUserDep,
    session: DBSessionDep,
    query: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> EligibleSkillsPage:
    return await assignments.list_eligible_skills(user.id, session, query=query, page=page, page_size=page_size)


@skills_router.get("/skills/", operation_id="skillGetMany")
async def list_skills(
    user: AuthedUserDep,
    session: DBSessionDep,
    query: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> SkillPage:
    return await service.list_skills(user.id, session, query=query, page=page, page_size=page_size)


@skills_router.post("/skills/", operation_id="skillCreate", status_code=201)
async def create(payload: SkillCreate, user: AuthedUserDep, session: DBSessionDep) -> Skill:
    return await service.create_skill(user.id, payload, session)


@skills_router.get("/skills/{skill_id}", operation_id="skillGetOne")
async def get_one(skill_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> Skill:
    return Skill.model_validate(await service.require_skill(user.id, skill_id, session))


@skills_router.put("/skills/{skill_id}", operation_id="skillUpdate")
async def update(skill_id: uuid.UUID, payload: SkillUpdate, user: AuthedUserDep, session: DBSessionDep) -> Skill:
    return await service.update_skill(user.id, skill_id, payload, session)


@skills_router.delete("/skills/{skill_id}", operation_id="skillDelete", status_code=204)
async def delete(
    skill_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
    expected_revision: int = Query(ge=1, le=MAX_REVISION),
) -> Response:
    await service.delete_skill(user.id, skill_id, expected_revision, session)
    return Response(status_code=204)
