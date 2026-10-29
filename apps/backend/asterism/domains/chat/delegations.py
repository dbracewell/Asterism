"""Collect live sub-agent events into persisted delegation records.

The orchestrator observes every forwarded ``SubAgentEventEnvelope`` during an
agent step and attaches the drained records to the assistant message that step
persists, so reloaded history can show the same delegation graph and summary as
the live stream. Records hold display data only (no thinking, no prompts) and
grant nothing.
"""

import time
import uuid

from asterism.domains.agent.schemas import AgentEventType, SubAgentEventEnvelope
from asterism.domains.llm.schemas import ToolCall, ToolResult

from .schemas import DelegationRecord, DelegationStatus


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
            model_name=envelope.model_name,
            depth=envelope.depth,
            status="running",
            started_at_ms=now,
            ended_at_ms=now,
        )
        update: dict[str, object] = {"ended_at_ms": now}
        if envelope.model_name:
            update["model_name"] = envelope.model_name
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
