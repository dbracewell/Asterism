"""Vector storage protocol and LanceDB implementation for knowledge chunks."""

import asyncio
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import lancedb
import pyarrow as pa


class VectorStoreError(RuntimeError):
    """A vector-store operation could not be completed safely."""


@dataclass(frozen=True)
class VectorChunk:
    id: str
    user_id: str
    knowledge_base_id: str
    document_id: str
    revision_id: str
    content: str
    vector: list[float]


@dataclass(frozen=True)
class VectorSearchResult:
    id: str
    user_id: str
    knowledge_base_id: str
    document_id: str
    revision_id: str
    content: str
    score: float


class VectorStore(Protocol):
    async def initialize(self) -> None: ...

    async def add(self, chunks: Sequence[VectorChunk]) -> None: ...

    async def search(
        self,
        query: Sequence[float],
        *,
        user_id: str,
        knowledge_base_ids: Sequence[str],
        limit: int,
    ) -> list[VectorSearchResult]: ...

    async def delete_document(self, *, user_id: str, document_id: str) -> None: ...

    async def delete_knowledge_base(self, *, user_id: str, knowledge_base_id: str) -> None: ...

    async def close(self) -> None: ...


class LanceDbVectorStore:
    """Single-table LanceDB store; every query is constrained by owner and base."""

    TABLE_NAME = "knowledge_chunks"

    def __init__(self, root: Path, *, dimension: int, max_concurrency: int = 2) -> None:
        self._root = root.resolve()
        self._dimension = dimension
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._connection = None
        self._table = None

    @staticmethod
    def _quote(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @property
    def schema(self) -> pa.Schema:
        return pa.schema(
            [
                pa.field("id", pa.string(), nullable=False),
                pa.field("user_id", pa.string(), nullable=False),
                pa.field("knowledge_base_id", pa.string(), nullable=False),
                pa.field("document_id", pa.string(), nullable=False),
                pa.field("revision_id", pa.string(), nullable=False),
                pa.field("content", pa.string(), nullable=False),
                pa.field("vector", pa.list_(pa.float32(), self._dimension), nullable=False),
            ]
        )

    def _initialize_sync(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        try:
            self._connection = lancedb.connect(str(self._root))
            self._table = self._connection.create_table(
                self.TABLE_NAME,
                schema=self.schema,
                exist_ok=True,
            )
        except Exception as error:
            raise VectorStoreError("Knowledge vector store could not be initialized") from error

    async def initialize(self) -> None:
        if self._table is None:
            async with self._semaphore:
                if self._table is None:
                    await asyncio.to_thread(self._initialize_sync)

    def _require_table(self):
        if self._table is None:
            raise VectorStoreError("Knowledge vector store is not initialized")
        return self._table

    def _validate_chunks(self, chunks: Sequence[VectorChunk]) -> None:
        for chunk in chunks:
            if len(chunk.vector) != self._dimension:
                raise ValueError("Knowledge vector has an unexpected dimension")
            if not all((chunk.id, chunk.user_id, chunk.knowledge_base_id, chunk.document_id, chunk.revision_id)):
                raise ValueError("Knowledge vector chunk identifiers must be non-empty")

    async def add(self, chunks: Sequence[VectorChunk]) -> None:
        if not chunks:
            return
        self._validate_chunks(chunks)
        await self.initialize()
        table = self._require_table()
        try:
            async with self._semaphore:
                await asyncio.to_thread(table.add, [asdict(chunk) for chunk in chunks])
        except Exception as error:
            raise VectorStoreError("Knowledge vectors could not be stored") from error

    async def search(
        self,
        query: Sequence[float],
        *,
        user_id: str,
        knowledge_base_ids: Sequence[str],
        limit: int,
    ) -> list[VectorSearchResult]:
        if len(query) != self._dimension:
            raise ValueError("Knowledge query vector has an unexpected dimension")
        if not user_id or not knowledge_base_ids:
            return []
        if limit < 1:
            raise ValueError("Knowledge search limit must be positive")
        await self.initialize()
        table = self._require_table()
        owner_filter = f"user_id = {self._quote(user_id)}"
        base_filter = "knowledge_base_id IN (" + ", ".join(self._quote(base) for base in knowledge_base_ids) + ")"
        try:
            async with self._semaphore:
                rows = await asyncio.to_thread(
                    lambda: (
                        table.search(list(query))
                        .where(f"{owner_filter} AND {base_filter}", prefilter=True)
                        .limit(limit)
                        .to_list()
                    )
                )
        except Exception as error:
            raise VectorStoreError("Knowledge vector search failed") from error
        return [
            VectorSearchResult(
                id=str(row["id"]),
                user_id=str(row["user_id"]),
                knowledge_base_id=str(row["knowledge_base_id"]),
                document_id=str(row["document_id"]),
                revision_id=str(row["revision_id"]),
                content=str(row["content"]),
                score=float(row["_distance"]),
            )
            for row in rows
        ]

    async def _delete(self, predicate: str) -> None:
        await self.initialize()
        table = self._require_table()
        try:
            async with self._semaphore:
                await asyncio.to_thread(table.delete, predicate)
        except Exception as error:
            raise VectorStoreError("Knowledge vectors could not be deleted") from error

    async def delete_document(self, *, user_id: str, document_id: str) -> None:
        await self._delete(f"user_id = {self._quote(user_id)} AND document_id = {self._quote(document_id)}")

    async def delete_knowledge_base(self, *, user_id: str, knowledge_base_id: str) -> None:
        await self._delete(f"user_id = {self._quote(user_id)} AND knowledge_base_id = {self._quote(knowledge_base_id)}")

    async def close(self) -> None:
        self._table = None
        self._connection = None
