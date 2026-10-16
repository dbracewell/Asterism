"""Immutable server-derived context shared by one agent execution tree."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

from asterism.core.exceptions import BadDataException


@dataclass(frozen=True)
class ModelIdentity:
    id: uuid.UUID
    provider_id: uuid.UUID | None = None
    name: str | None = None


@dataclass(frozen=True)
class FileProvenance:
    file_id: uuid.UUID
    sources: tuple[Literal["project", "chat"], ...]
    message_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True)
class ChatScopeSnapshot:
    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    active_branch_message_ids: tuple[uuid.UUID, ...]
    files: tuple[FileProvenance, ...]
    referenced_file_ids: frozenset[uuid.UUID] = frozenset()


@dataclass(frozen=True)
class ProjectScopeSnapshot:
    project_id: uuid.UUID
    prompt_revision: int
    eligible_sub_agent_ids: frozenset[uuid.UUID]
    files: tuple[FileProvenance, ...]
    system_prompt: str = ""


@dataclass(frozen=True)
class ExecutionScope:
    user_id: str
    user_profile_id: uuid.UUID | None
    agent_id: uuid.UUID
    is_sub_agent: bool
    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    selected_model: ModelIdentity | None
    executed_model: ModelIdentity | None
    eligible_sub_agent_ids: frozenset[uuid.UUID]
    effective_internal_tools: frozenset[str]
    active_branch_message_ids: tuple[uuid.UUID, ...]
    configuration_revision: int
    prompt_revision: int | None
    allowed_file_ids: frozenset[uuid.UUID]
    file_provenance: tuple[FileProvenance, ...]

    project_instructions: str = ""

    def narrow_for_sub_agent(
        self,
        *,
        agent_id: uuid.UUID,
        executed_model: ModelIdentity,
        configuration_revision: int,
        effective_internal_tools: frozenset[str],
    ) -> "ExecutionScope":
        if agent_id not in self.eligible_sub_agent_ids:
            raise BadDataException("Sub-agent is not eligible in this execution context")
        if not effective_internal_tools <= self.effective_internal_tools:
            raise BadDataException("Delegated execution cannot add internal tools")
        return ExecutionScope(
            user_id=self.user_id,
            user_profile_id=self.user_profile_id,
            agent_id=agent_id,
            is_sub_agent=True,
            chat_id=self.chat_id,
            project_id=self.project_id,
            selected_model=self.selected_model,
            executed_model=executed_model,
            eligible_sub_agent_ids=self.eligible_sub_agent_ids - {agent_id},
            effective_internal_tools=effective_internal_tools,
            active_branch_message_ids=self.active_branch_message_ids,
            configuration_revision=configuration_revision,
            prompt_revision=self.prompt_revision,
            project_instructions=self.project_instructions,
            allowed_file_ids=self.allowed_file_ids,
            file_provenance=self.file_provenance,
        )


async def resolve_execution_scope(
    *,
    user_id: str,
    user_profile_id: uuid.UUID | None,
    agent_id: uuid.UUID,
    is_sub_agent: bool,
    chat_id: uuid.UUID,
    selected_model: ModelIdentity | None,
    executed_model: ModelIdentity | None,
    effective_internal_tools: frozenset[str],
    configuration_revision: int,
    chat_scope_reader: Callable[[], Awaitable[ChatScopeSnapshot]],
    project_scope_reader: Callable[[uuid.UUID], Awaitable[ProjectScopeSnapshot]],
) -> ExecutionScope:
    chat = await chat_scope_reader()
    if chat.chat_id != chat_id:
        raise BadDataException("Chat scope reader returned a different chat")

    project = await project_scope_reader(chat.project_id) if chat.project_id is not None else None
    if project is not None and project.project_id != chat.project_id:
        raise BadDataException("Project scope reader returned a different project")

    provenance: dict[uuid.UUID, tuple[set[str], set[uuid.UUID]]] = {}
    for source in (*chat.files, *(project.files if project else ())):
        sources, message_ids = provenance.setdefault(source.file_id, (set(), set()))
        sources.update(source.sources)
        message_ids.update(source.message_ids)
    files = tuple(
        FileProvenance(
            file_id=file_id,
            sources=tuple(source for source in ("project", "chat") if source in sources),
            message_ids=tuple(sorted(message_ids, key=str)),
        )
        for file_id, (sources, message_ids) in sorted(provenance.items(), key=lambda item: str(item[0]))
    )

    return ExecutionScope(
        user_id=user_id,
        user_profile_id=user_profile_id,
        agent_id=agent_id,
        is_sub_agent=is_sub_agent,
        chat_id=chat_id,
        project_id=chat.project_id,
        selected_model=selected_model,
        executed_model=executed_model,
        eligible_sub_agent_ids=project.eligible_sub_agent_ids if project else frozenset(),
        effective_internal_tools=effective_internal_tools,
        active_branch_message_ids=chat.active_branch_message_ids,
        configuration_revision=configuration_revision,
        prompt_revision=project.prompt_revision if project else None,
        project_instructions=project.system_prompt if project else "",
        allowed_file_ids=frozenset(file.file_id for file in files),
        file_provenance=files,
    )
