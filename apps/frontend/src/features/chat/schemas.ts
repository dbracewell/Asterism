import { zMessageExecution } from "@/lib/client/zod.gen";
import { zMessage, zToolResult } from "@/lib/client/zod.gen";
import z from "zod";

export const FunctionSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  function: FunctionSchema,
  type: z.literal("function"),
});

export const ToolResultSchema = z.object({
  content: z.string(),
  is_empty: z.boolean(),
  raw_result: z.any(),
  tool_call: ToolCallSchema,
});

const AgentToolCallEvent = z.object({
  type: z.literal("tool_call"),
  tool_calls: z.array(ToolCallSchema),
});

const AgentToolPermissionRequest = z.object({
  type: z.literal("tool_permission_request"),
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
});

const AgentToolUpdate = z.object({
  type: z.literal("tool_update"),
  id: z.string(),
});

const AgentCompleteEvent = z.object({
  type: z.literal("complete"),
  last_messages: zMessage.array(),
});

const GenericAgentEvent = z.object({
  type: z.union([z.literal("start")]),
  execution: zMessageExecution.nullish(),
});

const AgentRegenerateEvent = z.object({
  type: z.literal("regenerate"),
  parent_id: z.uuidv4(),
});

const AgentErrorEvent = z.object({
  type: z.literal("error"),
  content: z.string(),
  // Stable provider error code, e.g. chatgpt_plan_usage_limit.
  error_code: z.string().nullish(),
});

const AgentDeltaEvent = z.object({
  type: z.literal("delta"),
  content: z.string(),
  thinking: z.string(),
});

const SubAgentStartEvent = z.object({
  type: z.literal("start"),
});

const SubAgentDeltaEvent = z.object({
  type: z.literal("delta"),
  content: z.string().default(""),
  thinking: z.string().default(""),
});

const SubAgentToolCallEvent = z.object({
  type: z.literal("tool_call"),
  tool_calls: z.array(ToolCallSchema).default([]),
});

const SubAgentCompleteEvent = z.object({
  type: z.literal("complete"),
  content: z.string().default(""),
  thinking: z.string().default(""),
  /** A step that called tools is intermediate; the child keeps working. */
  tool_calls: ToolCallSchema.array().default([]),
  /** Results of the tool calls this child step made. */
  tool_results: zToolResult.array().default([]),
});

const SubAgentErrorEvent = z.object({
  type: z.literal("error"),
  content: z.string(),
});

export const SubAgentChildEventSchema = z.discriminatedUnion("type", [
  SubAgentStartEvent,
  SubAgentDeltaEvent,
  SubAgentToolCallEvent,
  SubAgentCompleteEvent,
  SubAgentErrorEvent,
]);

export const AgentSubAgentEventSchema = z.object({
  type: z.literal("sub_agent"),
  execution_id: z.string(),
  /** Delegating sub-agent's execution; null when the main agent delegated. */
  parent_execution_id: z.string().nullish(),
  sub_agent_id: z.string(),
  sub_agent_name: z.string(),
  /** The fixed model binding that ran; the name is null until resolved. */
  model_id: z.string().nullish(),
  model_name: z.string().nullish(),
  depth: z.number(),
  event: SubAgentChildEventSchema,
});

export type AgentSubAgentEvent = z.infer<typeof AgentSubAgentEventSchema>;

export const AgentEventSchema = z.discriminatedUnion("type", [
  GenericAgentEvent,
  AgentToolCallEvent,
  AgentRegenerateEvent,
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentDeltaEvent,
  AgentToolUpdate,
  AgentToolPermissionRequest,
  AgentSubAgentEventSchema,
]);
