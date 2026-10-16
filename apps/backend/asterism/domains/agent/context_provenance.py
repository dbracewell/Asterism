"""Content-free execution provenance and boundaries for future derived context.

These values identify source context; they never authorize reads or writes.
"""

import hashlib
import json
import uuid
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict

from .execution_scope import ConfigurationProvenance

if TYPE_CHECKING:
    from .execution_scope import ExecutionScope


class ModelProvenance(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: uuid.UUID
    provider_id: uuid.UUID | None
    name: str | None


class ContextProvenance(BaseModel):
    model_config = ConfigDict(frozen=True)
    user_id: str
    user_profile_id: uuid.UUID | None
    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    execution_id: uuid.UUID | None
    request_message_id: uuid.UUID | None
    scope_revision: str
    allowed_file_ids: tuple[uuid.UUID, ...]
    active_branch_message_ids: tuple[uuid.UUID, ...]
    project_revision: int | None
    configurations: tuple[ConfigurationProvenance, ...]
    selected_sub_agent_ids: tuple[uuid.UUID, ...]
    selected_model: ModelProvenance | None
    executed_model: ModelProvenance | None


class MemoryNamespace(BaseModel):
    """Future memory must use this partition, never a profile-only namespace.

    Project namespaces may share explicitly written memory within a project.
    This does not implement automatic writes or project-wide chat history.
    """

    model_config = ConfigDict(frozen=True)
    user_id: str
    user_profile_id: uuid.UUID | None
    kind: Literal["project", "chat"]
    source_id: uuid.UUID

    @classmethod
    def from_scope(cls, scope: "ExecutionScope") -> "MemoryNamespace":
        return cls(
            user_id=scope.user_id,
            user_profile_id=scope.user_profile_id,
            kind="project" if scope.project_id else "chat",
            source_id=scope.project_id or scope.chat_id,
        )


class DerivedContextKey(BaseModel):
    """Exact source key for future summaries/caches, including local chat history.

    A matching key is necessary, but live authorization and source-generation
    checks are still required at every release. It is not an access token.
    """

    model_config = ConfigDict(frozen=True)
    namespace: MemoryNamespace
    chat_id: uuid.UUID
    scope_revision: str

    @classmethod
    def from_scope(cls, scope: "ExecutionScope") -> "DerivedContextKey":
        return cls(
            namespace=MemoryNamespace.from_scope(scope),
            chat_id=scope.chat_id,
            scope_revision=describe_context(scope).scope_revision,
        )


def describe_context(scope: "ExecutionScope") -> ContextProvenance:
    def model(identity):
        return (
            ModelProvenance(id=identity.id, provider_id=identity.provider_id, name=identity.name) if identity else None
        )

    configurations = scope.configuration_provenance or (
        ConfigurationProvenance(
            agent_id=scope.agent_id, revision=scope.configuration_revision, is_sub_agent=scope.is_sub_agent
        ),
    )
    selected = tuple(sorted(scope.selected_sub_agent_ids or scope.eligible_sub_agent_ids, key=str))
    # Canonical source identity includes branch/membership/provenance, not file text.
    source = {
        "user": scope.user_id,
        "profile": str(scope.user_profile_id),
        "chat": str(scope.chat_id),
        "project": str(scope.project_id),
        "project_revision": scope.prompt_revision,
        "branch": [str(value) for value in scope.active_branch_message_ids],
        "files": sorted(str(value) for value in scope.allowed_file_ids),
        "provenance": sorted(
            (str(file.file_id), sorted(file.sources), sorted(str(value) for value in file.message_ids))
            for file in scope.file_provenance
        ),
        "configurations": [value.model_dump(mode="json") for value in configurations],
        "targets": [str(value) for value in selected],
        "tools": sorted(scope.effective_internal_tools),
        "selected_model": model(scope.selected_model).model_dump(mode="json") if scope.selected_model else None,
        "executed_model": model(scope.executed_model).model_dump(mode="json") if scope.executed_model else None,
    }
    return ContextProvenance(
        user_id=scope.user_id,
        user_profile_id=scope.user_profile_id,
        chat_id=scope.chat_id,
        project_id=scope.project_id,
        execution_id=scope.execution_id,
        request_message_id=scope.request_message_id,
        scope_revision=hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest(),
        allowed_file_ids=tuple(sorted(scope.allowed_file_ids, key=str)),
        active_branch_message_ids=scope.active_branch_message_ids,
        project_revision=scope.prompt_revision,
        configurations=configurations,
        selected_sub_agent_ids=selected,
        selected_model=model(scope.selected_model),
        executed_model=model(scope.executed_model),
    )
