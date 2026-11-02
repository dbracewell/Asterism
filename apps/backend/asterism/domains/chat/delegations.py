"""Collect live sub-agent events into persisted delegation records.

The orchestrator observes every forwarded ``SubAgentEventEnvelope`` during an
agent step and attaches the drained records to the assistant message that step
persists, so reloaded history can show the same delegation graph and summary as
the live stream. Records hold display data only (no thinking, no prompts) and
grant nothing.
"""

import time
import uuid

from asterism.domains.agent.context_manifest import ContextManifest
from asterism.domains.agent.schemas import AgentEventType, SubAgentEventEnvelope
from asterism.domains.llm.schemas import ToolCall, ToolResult

from .context_manifest import retrieval_context
from .schemas import DelegationRecord, DelegationStatus, UsageStep


def _now_ms() -> int:
    return int(time.time() * 1000)


class DelegationCollector:
    """Accumulates one record per delegation execution, in first-seen order."""

    def __init__(self) -> None:
        self._records: dict[uuid.UUID, DelegationRecord] = {}

    def observe(self, envelope: SubAgentEventEnvelope, now_ms: int | None = None) -> None:
        now = _now_ms() if now_ms is None else now_ms
        record = self._records.get(envelope.execution_id) or DelegationRecord(
            execution_id=envelope.execution_id,
            parent_execution_id=envelope.parent_execution_id,
            sub_agent_id=envelope.sub_agent_id,
            name=envelope.sub_agent_name,
            model_id=envelope.model_id,
            model_name=envelope.model_name,
            depth=envelope.depth,
            status="running",
            started_at_ms=now,
            ended_at_ms=now,
        )
        update: dict[str, object] = {"ended_at_ms": now}
        if envelope.model_name:
            update["model_name"] = envelope.model_name
        # Usage provenance arrives once the child resolves its model; the
        # capability and context manifests arrive once, when the child starts.
        for key in ("model_id", "provider_type", "pricing", "capabilities", "context"):
            value = getattr(envelope, key)
            if value is not None:
                update[key] = value
        event = envelope.event
        match event.type:
            case AgentEventType.START:
                update |= {"status": "running", "error": None}
            case AgentEventType.TOOL_CALL:
                update["tool_calls"] = _merge_tool_calls(record.tool_calls, event.tool_calls)
            case AgentEventType.COMPLETE:
                # Each child step completes; its tool results arrive here. A
                # step that called tools is intermediate: the child keeps going.
                update |= {
                    "status": "running" if event.tool_calls else "completed",
                    "output": event.content or record.output,
                    "tool_results": _merge_tool_results(record.tool_results, event.tool_results),
                    "context": _with_retrieval(update.get("context") or record.context, event.tool_results),
                    "steps": [
                        *record.steps,
                        UsageStep(
                            input_tokens=max(event.input_tokens, 0),
                            output_tokens=max(event.output_tokens, 0),
                            generation_duration_ms=max(event.generation_duration_ms, 0),
                        ),
                    ],
                }
            case AgentEventType.ERROR:
                update |= {"status": "error", "error": event.content}
            case _:
                pass
        self._records[envelope.execution_id] = record.model_copy(update=update)

    def drain(self, unfinished: DelegationStatus = "error") -> list[DelegationRecord]:
        """Return the step's records and reset; unterminated runs get ``unfinished``."""
        records = [
            record if record.status != "running" else record.model_copy(update={"status": unfinished})
            for record in self._records.values()
        ]
        self._records = {}
        return records


def _with_retrieval(context: ContextManifest | None, results: list[ToolResult]) -> ContextManifest | None:
    """Add a child step's retrieved chunks to its recorded context manifest."""
    if context is None:
        return None
    chunks, omissions = retrieval_context(results)
    return context.model_copy(
        update={"chunks": [*context.chunks, *chunks], "omissions": [*context.omissions, *omissions]}
    )


def _merge_tool_results(previous: list[ToolResult], incoming: list[ToolResult]) -> list[ToolResult]:
    merged = {result.tool_call.id: result for result in previous}
    for result in incoming:
        merged[result.tool_call.id] = result
    return list(merged.values())


def _merge_tool_calls(previous: list[ToolCall], incoming: list[ToolCall]) -> list[ToolCall]:
    """Keep every distinct call the child made; a repeated id updates in place."""
    merged = {call.id: call for call in previous}
    for call in incoming:
        merged[call.id] = call
    return list(merged.values())
