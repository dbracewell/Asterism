import type { DelegationRecord } from "@/lib/client";

/** A settled one-second delegation; override any field. */
export const record = (
  id: string,
  overrides: Partial<DelegationRecord> = {},
): DelegationRecord => ({
  execution_id: id,
  parent_execution_id: null,
  sub_agent_id: `agent-${id}`,
  name: `Agent ${id}`,
  model_name: "Gamma",
  depth: 1,
  status: "completed",
  started_at_ms: 1_000,
  ended_at_ms: 2_000,
  tool_calls: [],
  tool_results: [],
  output: "",
  error: null,
  ...overrides,
});
