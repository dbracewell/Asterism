"""Publishing a course version (US-60.3).

A version snapshots the educator's project through the team-pack export, so it
meets the same allowlist, bounds and credential screen as a shared pack. The
course files are copied too, so later edits by the educator don't change what
students get until the next version.
"""

import hashlib
import json
import uuid
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException
from asterism.db.queries import paginate_select
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.queries import select_owned_agent_profiles
from asterism.domains.classes.service import owned_class
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.service import get_file_store
from asterism.domains.packs.documents import MAX_SUB_AGENTS, PackManifest, parse_pack
from asterism.domains.packs.export import export_pack
from asterism.domains.packs.schemas import PackExportRequest
from asterism.domains.projects.models import ProjectFileModel
from asterism.domains.projects.queries import selected_agent_ids

from .models import CourseFileModel, CourseVersionModel
from .schemas import CoursePublish, CourseVersion, CourseVersionPage
from .storage import remove_course_bytes

logger = get_logger("Courses")

MAX_COURSE_FILES = 20


def agent_key(agent_id: uuid.UUID) -> str:
    """Stable across versions, so an update changes the same student record."""
    return f"agent-{agent_id.hex}"


async def _selected_agents(user_id: str, project_id: uuid.UUID, session: AsyncSession) -> list[AgentProfileModel]:
    # The same order export uses, so its positional keys line up with these rows.
    rows = list(
        await session.scalars(
            select_owned_agent_profiles(user_id)
            .where(
                AgentProfileModel.sub_agent.is_(True),
                AgentProfileModel.id.in_(selected_agent_ids(user_id=user_id, project_id=project_id)),
            )
            .order_by(AgentProfileModel.name, AgentProfileModel.id)
        )
    )
    if len(rows) > MAX_SUB_AGENTS:
        raise BadDataException(f"A course can have at most {MAX_SUB_AGENTS} sub-agents")
    return rows


def _with_stable_keys(manifest: PackManifest, agents: list[AgentProfileModel]) -> PackManifest:
    data = json.loads(manifest.model_dump_json())
    renamed = {item["key"]: agent_key(row.id) for item, row in zip(data["sub_agents"], agents, strict=True)}
    for item in data["sub_agents"]:
        item["key"] = renamed[item["key"]]
    if data.get("project"):
        data["project"]["sub_agents"] = [renamed[key] for key in data["project"]["sub_agents"]]
    return parse_pack(json.dumps(data, ensure_ascii=False).encode("utf-8"))


async def _project_files(user_id: str, project_id: uuid.UUID, session: AsyncSession) -> list[UserFileModel]:
    rows = list(
        await session.scalars(
            select(UserFileModel)
            .join(ProjectFileModel, ProjectFileModel.file_id == UserFileModel.id)
            .where(
                ProjectFileModel.project_id == project_id,
                ProjectFileModel.user_id == user_id,
                UserFileModel.user_id == user_id,
            )
            .order_by(UserFileModel.filename)
        )
    )
    if len(rows) > MAX_COURSE_FILES:
        raise BadDataException(f"A course can have at most {MAX_COURSE_FILES} files")
    return rows


async def _latest(class_id: uuid.UUID, session: AsyncSession) -> CourseVersionModel | None:
    return await session.scalar(
        select(CourseVersionModel)
        .where(CourseVersionModel.class_id == class_id)
        .order_by(CourseVersionModel.number.desc())
        .limit(1)
    )


async def latest_version(class_id: uuid.UUID, session: AsyncSession) -> CourseVersionModel | None:
    return await _latest(class_id, session)


async def version_files(version_id: uuid.UUID, session: AsyncSession) -> list[CourseFileModel]:
    return list(
        await session.scalars(
            select(CourseFileModel).where(CourseFileModel.version_id == version_id).order_by(CourseFileModel.name)
        )
    )


def _view(row: CourseVersionModel, files: list[CourseFileModel]) -> CourseVersion:
    manifest = parse_pack(row.manifest.encode("utf-8"))
    return CourseVersion(
        id=row.id,
        number=row.number,
        note=row.note,
        created_at=row.created_at,
        sub_agent_names=[agent.name for agent in manifest.sub_agents],
        file_names=[file.name for file in files],
    )


async def publish(user_id: str, class_id: uuid.UUID, payload: CoursePublish, session: AsyncSession) -> CourseVersion:
    klass = await owned_class(user_id, class_id, session)
    agents = await _selected_agents(user_id, payload.project_id, session)
    previous = await _latest(class_id, session)
    number = (previous.number if previous else 0) + 1
    exported = await export_pack(
        user_id=user_id,
        project_id=payload.project_id,
        payload=PackExportRequest(
            name=klass.name,
            description=klass.description[:2_000],
            version=f"{number}.0.0",
            sub_agent_ids=[row.id for row in agents],
            include_project_settings=True,
        ),
        session=session,
    )
    manifest = _with_stable_keys(exported, agents)
    files = await _project_files(user_id, payload.project_id, session)

    store = get_file_store()
    reusable = {(row.name, row.sha256): row for row in (await version_files(previous.id, session) if previous else [])}
    saved: list[str] = []
    try:
        version = CourseVersionModel(
            class_id=class_id,
            number=number,
            note=payload.note,
            manifest=manifest.model_dump_json(),
            models=json.dumps({agent_key(row.id): str(row.model_id) for row in agents}),
        )
        session.add(version)
        await session.flush()
        kept: set[uuid.UUID] = set()
        for source in files:
            try:
                content = store.open(user_id, source.storage_key).read_bytes()
            except OSError as exc:
                raise BadDataException(f'File "{source.filename}" is missing; upload it again') from exc
            sha256 = hashlib.sha256(content).hexdigest()
            earlier = reusable.get((source.filename, sha256))
            if earlier is not None and earlier.storage_key:
                # Unchanged since the last version: move the bytes, don't copy them.
                key, earlier.storage_key = earlier.storage_key, None
                kept.add(earlier.id)
            else:
                key = store.save(user_id, uuid.uuid4(), Path(source.filename).suffix, content)
                saved.append(key)
            session.add(
                CourseFileModel(
                    version_id=version.id, name=source.filename, sha256=sha256, size=len(content), storage_key=key
                )
            )
        # Only the latest version keeps bytes; earlier ones keep names and hashes for "what changed".
        superseded = [row.storage_key for row in reusable.values() if row.id not in kept and row.storage_key]
        if previous is not None:
            await session.execute(
                update(CourseFileModel).where(CourseFileModel.version_id == previous.id).values(storage_key=None)
            )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        for key in saved:
            store.delete(user_id, key)
        raise ConflictException("Another version was published at the same time; try again") from exc
    except Exception:
        await session.rollback()
        for key in saved:
            store.delete(user_id, key)
        raise
    remove_course_bytes(user_id, superseded)
    logger.info(f"Educator {user_id} published version {number} of the course for class {class_id}")
    return _view(version, await version_files(version.id, session))


async def list_versions(
    user_id: str, class_id: uuid.UUID, session: AsyncSession, *, page: int, page_size: int
) -> CourseVersionPage:
    await owned_class(user_id, class_id, session)
    result = await paginate_select(
        statement=select(CourseVersionModel)
        .where(CourseVersionModel.class_id == class_id)
        .order_by(CourseVersionModel.number.desc()),
        session=session,
        page=page,
        page_size=page_size,
    )
    return CourseVersionPage(
        items=[_view(row, await version_files(row.id, session)) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )
