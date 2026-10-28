import {
  AgentTimelineStep,
  formatDuration,
  messageTimelineSteps,
} from "@/features/chat/lib/agent-timeline";
import type { SubAgentActivity } from "@/features/chat/types";
import type { DelegationRecord, Message } from "@/lib/client";
import { formatPlural } from "@/lib/formatters";

/** Persisted records in the shape the live graph and cards already draw. */
export const activitiesFromRecords = (
  records: DelegationRecord[],
): SubAgentActivity[] =>
  records.map((record) => ({
    executionId: record.execution_id,
    parentExecutionId: record.parent_execution_id ?? null,
    subAgentId: record.sub_agent_id,
    name: record.name,
    modelName: record.model_name ?? null,
    depth: record.depth,
    // A record is only persisted once its step has ended.
    status: record.status === "running" ? "cancelled" : record.status,
    content: record.output ?? "",
    thinking: "",
    toolCalls: (record.tool_calls ?? []).map((call) => ({
      ...call,
      type: "function" as const,
    })),
    error: record.error ?? undefined,
  }));

export const recordDurationMs = (record: DelegationRecord) =>
  Math.max(0, record.ended_at_ms - record.started_at_ms);

/** "3 agents · 12.0 s · 7 tools · 1 failed": wall time spans the whole run. */
export function delegationSummary(records: DelegationRecord[]): string {
  const start = Math.min(...records.map((record) => record.started_at_ms));
  const end = Math.max(...records.map((record) => record.ended_at_ms));
  const tools = records.reduce(
    (total, record) => total + (record.tool_calls?.length ?? 0),
    0,
  );
  const failed = records.filter((record) => record.status === "error").length;
  const cancelled = records.filter(
    (record) => record.status === "cancelled" || record.status === "running",
  ).length;
  return [
    formatPlural(records.length, "agent"),
    formatDuration(Math.max(0, end - start)),
    formatPlural(tools, "tool"),
    failed > 0 && `${failed} failed`,
    cancelled > 0 && `${cancelled} cancelled`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The child's own tool calls, with recorded results, as timeline steps. */
export const delegationSteps = (
  record: DelegationRecord,
): AgentTimelineStep[] =>
  messageTimelineSteps(
    {
      id: record.execution_id,
      role: "assistant",
      content: "",
      created_at: 0,
      status: "completed",
      tool_calls: record.tool_calls,
      tool_call_results: record.tool_results,
    } as Message,
    { showThinking: false },
  );
