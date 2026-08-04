import { zMessageModel } from "@/lib/client/zod.gen";
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

const AgentCompleteEvent = z.object({
  type: z.literal("complete"),
  last_messages: zMessageModel.array(),
});

const AgentStartEvent = z.object({
  type: z.literal("start"),
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
  AgentStartEvent,
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentDeltaEvent,
]);
