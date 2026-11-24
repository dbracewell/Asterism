"""Memory embeddings in their own LanceDB table (ADR-0078).

One row per memory, keyed by owner and memory id. The vectors are a cache of the
memory text: a missing one is rebuilt from the database row, never the reverse.
Rows carry ids and scope only, never the text.
"""

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import lancedb
import pyarrow as pa

from asterism.core import config
from asterism.domains.knowledge.embedding import EMBEDDING_MODEL_KEY, embedding_provider


class MemoryVectorError(RuntimeError):
    """The memory vector table could not be opened, written or read."""


@dataclass(frozen=True)
class MemoryVector:
    memory_id: str
    user_id: str
    kind: str
    project_id: str  # Empty for user memory.
    revision: int
    vector: list[float]


class MemoryVectorStore(Protocol):
    async def initialize(self) -> None: ...

    async def write(self, row: MemoryVector) -> None: ...

    async def delete_memories(self, *, user_id: str, memory_ids: Sequence[uuid.UUID | str]) -> None: ...

    async def delete_project(self, *, user_id: str, project_id: uuid.UUID) -> None: ...

    async def delete_user(self, *, user_id: str) -> None: ...

    async def list_owners(self) -> set[str]: ...

    async def list_revisions(self, *, user_id: str) -> dict[str, int]: ...

    async def search(
        self, *, user_id: str, project_id: uuid.UUID | None, vector: Sequence[float], limit: int
    ) -> list[str]: ...

    async def close(self) -> None: ...


class LanceDbMemoryVectorStore:
    # Named for the embedding model, like the knowledge table (ADR-0079); another
    # model's table is dropped on start and the vectors rebuilt from the rows.
    TABLE_PREFIX = "memory_vectors"

    def __init__(self, root: Path, *, dimension: int, model_key: str, max_concurrency: int = 2) -> None:
        self._root = root.resolve()
        self._dimension = dimension
        self.table_name = f"{self.TABLE_PREFIX}__{model_key}"
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._table = None

    @staticmethod
    def _quote(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @property
    def schema(self) -> pa.Schema:
        return pa.schema(
            [
                pa.field("memory_id", pa.string(), nullable=False),
                pa.field("user_id", pa.string(), nullable=False),
                pa.field("kind", pa.string(), nullable=False),
                pa.field("project_id", pa.string(), nullable=False),
                pa.field("revision", pa.int32(), nullable=False),
                pa.field("vector", pa.list_(pa.float32(), self._dimension), nullable=False),
            ]
        )

    def _initialize_sync(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        try:
            connection = lancedb.connect(str(self._root))
            for name in connection.table_names():
                if name.startswith(self.TABLE_PREFIX) and name != self.table_name:
                    connection.drop_table(name)
            self._table = connection.create_table(self.table_name, schema=self.schema, exist_ok=True)
        except Exception as error:
            raise MemoryVectorError("Memory vector table could not be initialized") from error

    async def initialize(self) -> None:
        if self._table is None:
            async with self._semaphore:
                if self._table is None:
                    await asyncio.to_thread(self._initialize_sync)

    async def _run(self, action, message: str):
        await self.initialize()
        table = self._table
        if table is None:
            raise MemoryVectorError("Memory vector table is not initialized")
        try:
            async with self._semaphore:
                return await asyncio.to_thread(action, table)
        except Exception as error:
            raise MemoryVectorError(message) from error

    async def write(self, row: MemoryVector) -> None:
        """Replace the memory's vector with this one."""
        if len(row.vector) != self._dimension:
            raise ValueError("Memory vector has an unexpected dimension")
        if not row.memory_id or not row.user_id:
            raise ValueError("Memory vector identifiers must be non-empty")
        predicate = f"memory_id = {self._quote(row.memory_id)} AND user_id = {self._quote(row.user_id)}"

        def replace(table) -> None:
            table.delete(predicate)
            table.add([asdict(row)])

        await self._run(replace, "Memory vector could not be stored")

    async def delete_memories(self, *, user_id: str, memory_ids: Sequence[uuid.UUID | str]) -> None:
        if not memory_ids:
            return
        ids = ", ".join(self._quote(str(memory_id)) for memory_id in memory_ids)
        predicate = f"user_id = {self._quote(user_id)} AND memory_id IN ({ids})"
        await self._run(lambda table: table.delete(predicate), "Memory vectors could not be deleted")

    async def delete_project(self, *, user_id: str, project_id: uuid.UUID) -> None:
        predicate = f"user_id = {self._quote(user_id)} AND project_id = {self._quote(str(project_id))}"
        await self._run(lambda table: table.delete(predicate), "Memory vectors could not be deleted")

    async def delete_user(self, *, user_id: str) -> None:
        predicate = f"user_id = {self._quote(user_id)}"
        await self._run(lambda table: table.delete(predicate), "Memory vectors could not be deleted")

    async def list_owners(self) -> set[str]:
        """Every owner with a stored vector."""

        def read(table) -> set[str]:
            return {row["user_id"] for row in table.search().select(["user_id"]).limit(None).to_list()}

        return await self._run(read, "Memory vectors could not be read")

    async def list_revisions(self, *, user_id: str) -> dict[str, int]:
        """The owner's stored vectors: memory id to the revision it was embedded at."""
        predicate = f"user_id = {self._quote(user_id)}"

        def read(table) -> dict[str, int]:
            rows = table.search().where(predicate).select(["memory_id", "revision"]).limit(None).to_list()
            return {row["memory_id"]: row["revision"] for row in rows}

        return await self._run(read, "Memory vectors could not be read")

    async def search(
        self, *, user_id: str, project_id: uuid.UUID | None, vector: Sequence[float], limit: int
    ) -> list[str]:
        """Memory ids nearest the vector: the owner's user memory, plus that project's memory."""
        if len(vector) != self._dimension:
            raise ValueError("Memory query vector has an unexpected dimension")
        scope = "kind = 'user'"
        if project_id is not None:
            scope = f"(kind = 'user' OR project_id = {self._quote(str(project_id))})"
        predicate = f"user_id = {self._quote(user_id)} AND {scope}"

        def read(table) -> list[str]:
            rows = (
                table.search(list(vector)).where(predicate, prefilter=True).select(["memory_id"]).limit(limit).to_list()
            )
            return [row["memory_id"] for row in rows]

        return await self._run(read, "Memory vectors could not be searched")

    async def close(self) -> None:
        self._table = None


memory_vector_store: MemoryVectorStore = LanceDbMemoryVectorStore(
    config.knowledge_root / "lancedb", dimension=embedding_provider.dimension, model_key=EMBEDDING_MODEL_KEY
)
