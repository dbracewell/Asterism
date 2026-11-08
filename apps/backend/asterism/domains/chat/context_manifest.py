"""Build the context manifest recorded with each assistant step (US-54.3).

The orchestrator records what it actually sent: the prompt snapshot's layers,
each attached file's inclusion, and per step the chunks that search_knowledge
returned. Only references and reasons are kept; content stays in the private
prompt snapshot and in the step's untrusted tool results.
"""

import uuid
from collections.abc import Iterable, Mapping

from pydantic import ValidationError

from asterism.domains.agent.context_manifest import (
    ContextChunk,
    ContextCompaction,
    ContextFile,
    ContextManifest,
    ContextOmission,
    FileInclusion,
    OmissionKind,
    layer_references,
    runtime_omissions,
)
from asterism.domains.agent.prompts import PromptSnapshot
from asterism.domains.files.runtime_access import FileModelInput
from asterism.domains.llm.schemas import ToolResult
from asterism.domains.prompt_templates.provenance import TemplateProvenance
from asterism.domains.retrieval.service import RetrievalResponse

from .schemas import MessageFileReference

UNAVAILABLE_FILE = "No longer available to this chat."


def file_context(
    references: Iterable[MessageFileReference], payloads: Mapping[uuid.UUID, FileModelInput]
) -> list[ContextFile]:
    """One entry per attached file, in first-attached order."""
    files: dict[uuid.UUID, ContextFile] = {}
    for reference in references:
        if reference.file_id in files:
            continue
        payload = payloads.get(reference.file_id)
        if payload is None:
            inclusion, reason = FileInclusion.OMITTED, UNAVAILABLE_FILE
        elif payload.image_url is not None:
            inclusion, reason = FileInclusion.IMAGE, None
        elif payload.text is not None:
            inclusion, reason = FileInclusion.TEXT, None
        else:
            inclusion, reason = FileInclusion.OMITTED, payload.reason or "Could not be read."
        files[reference.file_id] = ContextFile(
            file_id=reference.file_id, name=reference.name, inclusion=inclusion, reason=reason
        )
    return list(files.values())


def turn_context(
    snapshot: PromptSnapshot | None,
    *,
    template: TemplateProvenance | None = None,
    files: list[ContextFile] | None = None,
    omissions: Iterable[ContextOmission] = (),
    compaction: ContextCompaction | None = None,
) -> ContextManifest:
    """What every step of a run shares: layers, summary, template, files and fixed omissions."""
    return ContextManifest(
        layers=layer_references(snapshot) if snapshot else [],
        compaction=compaction,
        template=template,
        files=files or [],
        omissions=[*(runtime_omissions(snapshot) if snapshot else []), *omissions],
    )


def retrieval_context(tool_results: Iterable[ToolResult]) -> tuple[list[ContextChunk], list[ContextOmission]]:
    """Chunk references and retrieval omissions from one step's search results."""
    chunks: list[ContextChunk] = []
    omissions: list[ContextOmission] = []
    for result in tool_results:
        if result.tool_call.function.name != "search_knowledge" or not isinstance(result.raw_result, dict):
            continue
        try:
            response = RetrievalResponse.model_validate(result.raw_result)
        except ValidationError:
            continue
        call_id = result.tool_call.id
        chunks.extend(
            ContextChunk(
                tool_call_id=call_id,
                file_id=hit.file_id,
                chunk_id=hit.chunk_id,
                artifact_generation=hit.artifact_generation,
                score=hit.score,
                truncated=hit.truncated,
            )
            for hit in response.results
        )
        if response.message:
            omissions.append(ContextOmission(kind=OmissionKind.RETRIEVAL, subject=call_id, reason=response.message))
        if response.omitted_for_budget:
            count = response.omitted_for_budget
            omissions.append(
                ContextOmission(
                    kind=OmissionKind.RETRIEVED_EXCERPT,
                    subject=call_id,
                    reason=f"{count} more {'match was' if count == 1 else 'matches were'} left out "
                    "to fit the result size limit.",
                )
            )
    return chunks, omissions


def step_context(turn: ContextManifest, tool_results: Iterable[ToolResult]) -> ContextManifest:
    chunks, omissions = retrieval_context(tool_results)
    return turn.model_copy(update={"chunks": chunks, "omissions": [*turn.omissions, *omissions]})
