"""A student's copy of a course: review, add and update (US-60.3).

The copy is made of the student's own ordinary records, so every existing owner
check, capability rule and isolation boundary applies to it unchanged. Adding
or updating is the student's explicit approval of what the offer lists:
sub-agents with the educator's models, and only the tools admin policy allows
now. Course items are changed in place; the student's chats are untouched.
"""

import json
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.schemas import SubAgentCreate
from asterism.domains.agent.service import new_sub_agent, replace_sub_agent
from asterism.domains.chatgpt.availability import available_user_model
from asterism.domains.classes.models import ClassMemberModel, ClassModel
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.service import (
    NewLibraryFile,
    delete_user_files,
    get_file_store,
    new_library_file,
    start_file_ingestion,
)
from asterism.domains.packs.documents import (
    MAX_AGENT_NAME_LENGTH,
    PackManifest,
    PackSubAgent,
    folded_name,
    parse_pack,
)
from asterism.domains.packs.review import available_tools, existing_names
from asterism.domains.projects.models import ProjectFileModel, ProjectModel, ProjectSubAgentModel
from asterism.domains.projects.revocation import revoke_agent_projects
from asterism.domains.projects.schemas import ProjectCreate
from asterism.domains.settings.models import LLMModel

from .models import CourseCopyItemModel, CourseCopyModel, CourseFileModel, CourseItemType, CourseVersionModel
from .publish import latest_version, version_files
from .schemas import (
    CourseApplied,
    CourseChange,
    CourseCopy,
    CourseFile,
    CourseOffer,
    CourseSubAgent,
)

logger = get_logger("CourseCopies")

MAX_PROJECT_NAME_LENGTH = 255
CLASS_NOT_FOUND = "Class not found"


async def _member_class(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> ClassModel:
    """Current members only; a removed student keeps their copy but gets no updates."""
    row = await session.scalar(
        select(ClassModel)
        .join(ClassMemberModel, ClassMemberModel.class_id == ClassModel.id)
        .where(
            ClassModel.id == class_id,
            ClassMemberModel.user_id == user_id,
            ClassMemberModel.removed_at.is_(None),
        )
    )
    if row is None:
        raise NotFoundException(CLASS_NOT_FOUND)
    return row


def _manifest(version: CourseVersionModel) -> PackManifest:
    return parse_pack(version.manifest.encode("utf-8"))


def _models(version: CourseVersionModel) -> dict[str, uuid.UUID]:
    return {key: uuid.UUID(value) for key, value in json.loads(version.models).items()}


def _agent_fingerprint(agent: PackSubAgent, model_id: uuid.UUID | None) -> str:
    return json.dumps([agent.model_dump(mode="json", exclude={"name"}), str(model_id)], sort_keys=True)


def _settings(manifest: PackManifest) -> tuple:
    project = manifest.project
    return (project.description, project.system_prompt, project.goal, project.accent) if project else ()


def course_changes(
    old: CourseVersionModel,
    old_files: list[CourseFileModel],
    new: CourseVersionModel,
    new_files: list[CourseFileModel],
) -> list[CourseChange]:
    """What a student gets by updating from ``old`` to ``new``, in a stable order."""
    before, after = _manifest(old), _manifest(new)
    changes: list[CourseChange] = []
    if _settings(before) != _settings(after):
        changes.append(CourseChange(kind="changed", item="settings", name="Course instructions and settings"))
    old_models, new_models = _models(old), _models(new)
    old_agents = {agent.key: agent for agent in before.sub_agents}
    for agent in after.sub_agents:
        previous = old_agents.pop(agent.key, None)
        if previous is None:
            changes.append(CourseChange(kind="added", item="sub_agent", name=agent.name))
        elif _agent_fingerprint(previous, old_models.get(agent.key)) != _agent_fingerprint(
            agent, new_models.get(agent.key)
        ):
            changes.append(CourseChange(kind="changed", item="sub_agent", name=agent.name))
    changes += [CourseChange(kind="removed", item="sub_agent", name=agent.name) for agent in old_agents.values()]
    old_by_name = {file.name: file.sha256 for file in old_files}
    for file in new_files:
        sha = old_by_name.pop(file.name, None)
        if sha is None:
            changes.append(CourseChange(kind="added", item="file", name=file.name))
        elif sha != file.sha256:
            changes.append(CourseChange(kind="changed", item="file", name=file.name))
    changes += [CourseChange(kind="removed", item="file", name=name) for name in old_by_name]
    return changes


async def _offered_agents(
    user_id: str, manifest: PackManifest, models: dict[str, uuid.UUID], tools: frozenset[str], session: AsyncSession
) -> list[tuple[PackSubAgent, LLMModel | None, list[str]]]:
    offered = []
    for agent in manifest.sub_agents:
        model = await available_user_model(user_id, models[agent.key], session)
        granted = [tool for tool in agent.requested_tools if tool in tools] if model and model.supports_tools else []
        offered.append((agent, model, granted))
    return offered


async def _live_copy(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> CourseCopyModel | None:
    return await session.get(CourseCopyModel, (class_id, user_id), populate_existing=True)


async def _owned_project(user_id: str, project_id: uuid.UUID | None, session: AsyncSession) -> ProjectModel | None:
    if project_id is None:
        return None
    return await session.scalar(
        select(ProjectModel).where(ProjectModel.id == project_id, ProjectModel.user_id == user_id)
    )


async def read_offer(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> CourseOffer | None:
    await _member_class(user_id, class_id, session)
    latest = await latest_version(class_id, session)
    if latest is None:
        return None
    manifest = _manifest(latest)
    files = await version_files(latest.id, session)
    offered = await _offered_agents(user_id, manifest, _models(latest), await available_tools(session), session)
    copy = await _live_copy(user_id, class_id, session)
    current = None
    changes: list[CourseChange] = []
    if copy is not None:
        project = await _owned_project(user_id, copy.project_id, session)
        had = await session.get(CourseVersionModel, copy.version_id)
        assert had is not None
        current = CourseCopy(version_number=had.number, project_id=project.id if project else None)
        if had.id != latest.id:
            changes = course_changes(had, await version_files(had.id, session), latest, files)
    return CourseOffer(
        version_number=latest.number,
        note=latest.note,
        published_at=latest.created_at,
        instructions=manifest.project.system_prompt if manifest.project else "",
        sub_agents=[
            CourseSubAgent(
                name=agent.name,
                description=agent.description,
                model_name=(model.display_name or model.name) if model else None,
                tools=granted,
            )
            for agent, model, granted in offered
        ],
        files=[CourseFile(name=file.name, size=file.size) for file in files],
        current=current,
        changes=changes,
    )


def _unique_name(name: str, taken: set[str], suffix: str, limit: int) -> str:
    """Course items are added in one click, so a clash gets the class name, not a prompt."""
    candidates = [name, f"{name} ({suffix})", *(f"{name} ({suffix} {n})" for n in range(2, 100))]
    for candidate in candidates:
        candidate = candidate[:limit].strip()
        if candidate and folded_name(candidate) not in taken:
            taken.add(folded_name(candidate))
            return candidate
    raise ConflictException("Couldn't find a free name for a course item; rename some of yours and try again")


class _Sync:
    """Brings the student's records in line with one course version, in one transaction."""

    def __init__(self, user_id: str, klass: ClassModel, version: CourseVersionModel, session: AsyncSession):
        self.user_id = user_id
        self.klass = klass
        self.version = version
        self.session = session
        self.manifest = _manifest(version)
        self.items: dict[tuple[CourseItemType, str], CourseCopyItemModel] = {}
        self.new_items: list[CourseCopyItemModel] = []
        self.new_files: list[NewLibraryFile] = []
        self.superseded_files: list[uuid.UUID] = []

    async def project(self, copy: CourseCopyModel | None) -> ProjectModel:
        source = self.manifest.project
        assert source is not None
        settings = {
            "description": source.description,
            "system_prompt": source.system_prompt,
            "goal": source.goal,
            "accent": source.accent,
        }
        existing = await _owned_project(self.user_id, copy.project_id if copy else None, self.session)
        if existing is not None:
            await self.session.execute(
                update(ProjectModel)
                .where(ProjectModel.id == existing.id, ProjectModel.user_id == self.user_id)
                .values(**settings, context_revision=ProjectModel.context_revision + 1)
            )
            return existing
        taken = set((await existing_names(self.user_id, self.session)).projects)
        name = _unique_name(self.klass.name, taken, "course", MAX_PROJECT_NAME_LENGTH)
        project = ProjectModel(user_id=self.user_id, **ProjectCreate(name=name, **settings).model_dump())
        self.session.add(project)
        await self.session.flush()
        # A new project starts empty, so earlier records are re-linked or re-made below.
        return project

    async def sub_agents(self, project: ProjectModel, tools: frozenset[str]) -> None:
        models = _models(self.version)
        taken = set((await existing_names(self.user_id, self.session)).sub_agents)
        wanted = set()
        for agent in self.manifest.sub_agents:
            wanted.add(agent.key)
            model = await available_user_model(self.user_id, models[agent.key], self.session)
            if model is None:
                raise BadDataException(
                    f"The course sub-agent “{agent.name}” uses a model that isn't available to you. Ask your educator."
                )
            granted = [tool for tool in agent.requested_tools if tool in tools] if model.supports_tools else []
            item = self.items.get((CourseItemType.SUB_AGENT, agent.key))
            row = None
            if item is not None:
                row = await self.session.scalar(
                    select(AgentProfileModel).where(
                        AgentProfileModel.id == item.record_id,
                        AgentProfileModel.user_id == self.user_id,
                        AgentProfileModel.sub_agent.is_(True),
                    )
                )
            name = (
                row.name if row is not None else _unique_name(agent.name, taken, self.klass.name, MAX_AGENT_NAME_LENGTH)
            )
            payload = SubAgentCreate(
                name=name,
                description=agent.description,
                model_id=model.id,
                system_prompt=agent.instructions,
                max_steps=agent.max_steps,
                tools=granted,
                chat_parameters=agent.generation,
            )
            if row is None:
                row = await new_sub_agent(self.user_id, payload, self.session)
                self.session.add(row)
                await self.session.flush()
            else:
                await replace_sub_agent(self.user_id, row, payload, self.session)
            await self._select(project, row.id)
            self.new_items.append(
                CourseCopyItemModel(
                    class_id=self.klass.id,
                    user_id=self.user_id,
                    item_type=CourseItemType.SUB_AGENT,
                    item_key=agent.key,
                    record_id=row.id,
                )
            )
        for (kind, key), item in self.items.items():
            if kind is CourseItemType.SUB_AGENT and key not in wanted:
                await self._remove_agent(item.record_id)

    async def _select(self, project: ProjectModel, agent_id: uuid.UUID) -> None:
        if await self.session.get(ProjectSubAgentModel, (project.id, agent_id)) is None:
            self.session.add(ProjectSubAgentModel(project_id=project.id, agent_id=agent_id, user_id=self.user_id))

    async def _remove_agent(self, agent_id: uuid.UUID) -> None:
        row = await self.session.scalar(
            select(AgentProfileModel).where(
                AgentProfileModel.id == agent_id,
                AgentProfileModel.user_id == self.user_id,
                AgentProfileModel.sub_agent.is_(True),
            )
        )
        if row is not None:
            await revoke_agent_projects(user_id=self.user_id, agent_id=agent_id, session=self.session)
            await self.session.delete(row)

    async def files(self, project: ProjectModel, educator_id: str) -> None:
        store = get_file_store()
        wanted = set()
        for source in await version_files(self.version.id, self.session):
            wanted.add(source.name)
            item = self.items.get((CourseItemType.FILE, source.name))
            current = None
            if item is not None:
                current = await self.session.scalar(
                    select(UserFileModel).where(
                        UserFileModel.id == item.record_id, UserFileModel.user_id == self.user_id
                    )
                )
            if current is not None and item is not None and item.sha256 == source.sha256:
                file_id = current.id
            else:
                if current is not None:
                    self.superseded_files.append(current.id)
                if not source.storage_key:
                    raise ConflictException("The course changed while you were adding it; review it again")
                content = store.open(educator_id, source.storage_key).read_bytes()
                created = await new_library_file(
                    user_id=self.user_id, original_name=source.name, content=content, session=self.session
                )
                self.new_files.append(created)
                file_id = created.model.id
            if await self.session.get(ProjectFileModel, (project.id, file_id)) is None:
                self.session.add(ProjectFileModel(project_id=project.id, file_id=file_id, user_id=self.user_id))
            self.new_items.append(
                CourseCopyItemModel(
                    class_id=self.klass.id,
                    user_id=self.user_id,
                    item_type=CourseItemType.FILE,
                    item_key=source.name,
                    record_id=file_id,
                    sha256=source.sha256,
                )
            )
        for (kind, key), item in self.items.items():
            if kind is CourseItemType.FILE and key not in wanted:
                self.superseded_files.append(item.record_id)


async def apply_course(user_id: str, class_id: uuid.UUID, version_number: int, session: AsyncSession) -> CourseApplied:
    """Add the course, or update the student's copy to the latest version."""
    klass = await _member_class(user_id, class_id, session)
    latest = await latest_version(class_id, session)
    if latest is None:
        raise NotFoundException("This class has no course yet")
    if latest.number != version_number:
        raise ConflictException("Your educator published a newer version; review it first")
    copy = await _live_copy(user_id, class_id, session)
    sync = _Sync(user_id, klass, latest, session)
    if copy is not None:
        rows = await session.scalars(
            select(CourseCopyItemModel).where(
                CourseCopyItemModel.class_id == class_id, CourseCopyItemModel.user_id == user_id
            )
        )
        sync.items = {(row.item_type, row.item_key): row for row in rows}
    store = get_file_store()
    try:
        project = await sync.project(copy)
        await sync.sub_agents(project, await available_tools(session))
        await sync.files(project, klass.educator_id)
        await session.execute(
            delete(CourseCopyItemModel).where(
                CourseCopyItemModel.class_id == class_id, CourseCopyItemModel.user_id == user_id
            )
        )
        if copy is None:
            copy = CourseCopyModel(class_id=class_id, user_id=user_id, version_id=latest.id, project_id=project.id)
            session.add(copy)
        else:
            copy.version_id = latest.id
            copy.project_id = project.id
        await session.flush()
        session.add_all(sync.new_items)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        for created in sync.new_files:
            store.delete(user_id, created.storage_key)
        raise ConflictException("Something changed while the course was being added; try again") from exc
    except Exception:
        await session.rollback()
        for created in sync.new_files:
            store.delete(user_id, created.storage_key)
        raise
    for created in sync.new_files:
        start_file_ingestion(created)
    await _remove_superseded(user_id, sync.superseded_files, session)
    logger.info(f"User {user_id} applied version {latest.number} of the course for class {class_id}")
    return CourseApplied(project_id=project.id, version_number=latest.number)


async def _remove_superseded(user_id: str, file_ids: list[uuid.UUID], session: AsyncSession) -> None:
    """Old copies of course files go once the update has committed; best effort."""
    if not file_ids:
        return
    names = list(
        await session.scalars(
            select(UserFileModel.filename).where(UserFileModel.user_id == user_id, UserFileModel.id.in_(file_ids))
        )
    )
    try:
        await delete_user_files(user_id=user_id, filenames=names, session=session)
    except Exception:
        logger.warning("Could not remove superseded course files", extra={"user_id": user_id})
