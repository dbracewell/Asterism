import { zMessage } from "@/lib/client/zod.gen";
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
});

const AgentRegenerateEvent = z.object({
  type: z.literal("regenerate"),
  parent_id: z.uuidv4(),
});

const AgentErrorEvent = z.object({
  type: z.literal("error"),
  content: z.string(),
});

const AgentDeltaEvent = z.object({
  type: z.literal("delta"),
  content: z.string(),
  thinking: z.string(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  GenericAgentEvent,
  AgentToolCallEvent,
  AgentRegenerateEvent,
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentDeltaEvent,
  AgentToolUpdate,
  AgentToolPermissionRequest,
]);
