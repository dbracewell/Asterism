"""Composition root for reading a project's files through the retrieval domain."""

import uuid

from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import FileProvenance
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
from asterism.domains.knowledge.queries import select_current_owned_artifacts
from asterism.domains.knowledge.runtime import vector_store
from asterism.domains.projects.scope import read_project_context
from asterism.domains.retrieval.service import RetrievalArtifact, RetrievalSnapshot
from asterism.domains.retrieval.sources import SourceReader

MAX_CHUNKS_PER_FILE = 200


async def read_project_snapshot(*, user_id: str, project_id: uuid.UUID) -> RetrievalSnapshot:
    """Live project membership plus current artifacts; 404 if the project is gone or foreign."""
    async with get_async_db_session() as session:
        project, file_ids = await read_project_context(user_id=user_id, project_id=project_id, session=session)
        artifacts = tuple(
            RetrievalArtifact(
                file_id=artifact.file_id,
                generation=artifact.generation,
                status=artifact.status,
                searchable=artifact.searchable,
            )
            for artifact in await session.scalars(
                select_current_owned_artifacts(user_id).where(FileKnowledgeArtifactModel.file_id.in_(file_ids))
            )
        )
    files = tuple(FileProvenance(file_id=file_id, sources=("project",)) for file_id in file_ids)
    return RetrievalSnapshot(files, artifacts, project.context_revision)


def create_source_reader(*, user_id: str, project_id: uuid.UUID) -> SourceReader:
    async def read() -> RetrievalSnapshot:
        return await read_project_snapshot(user_id=user_id, project_id=project_id)

    return SourceReader(user_id=user_id, read_snapshot=read, vectors=vector_store, max_chunks=MAX_CHUNKS_PER_FILE)
