import { AgentSubAgentEvent, ToolCallSchema } from "@/features/chat/schemas";
import { Message, ToolResult } from "@/lib/client";
import z from "zod";
import { ReadyState } from "react-use-websocket";

export type ConnectionStatus =
  | "Connecting"
  | "Connected"
  | "Closing"
  | "Closed"
  | "Uninstantiated";

export const connectionStatusMap = {
  [ReadyState.CONNECTING]: "Connecting",
  [ReadyState.OPEN]: "Connected",
  [ReadyState.CLOSING]: "Closing",
  [ReadyState.CLOSED]: "Closed",
  [ReadyState.UNINSTANTIATED]: "Uninstantiated",
} as Record<number, ConnectionStatus>;

export type ScrollState = {
  userInitiatedScroll: boolean;
  preventAutoScroll: boolean;
};

export type PermissionRequest = {
  id: string;
  name: string;
  arguments: string;
};

export type StreamingMessage = Message & {
  needsPermission?: PermissionRequest[];
};

export type SubAgentActivity = {
  executionId: string;
  /** Delegating sub-agent's execution; null when the main agent delegated. */
  parentExecutionId: string | null;
  subAgentId: string;
  name: string;
  modelName: string | null;
  depth: number;
  /** `cancelled` only comes from persisted history (a stopped turn). */
  status: "running" | "completed" | "error" | "cancelled";
  content: string;
  thinking: string;
  toolCalls: z.infer<typeof ToolCallSchema>[];
  toolResults: ToolResult[];
  error?: string;
};

const mergeToolResults = (previous: ToolResult[], incoming: ToolResult[]) => [
  ...previous.filter(
    (result) =>
      !incoming.some((next) => next.tool_call.id === result.tool_call.id),
  ),
  ...incoming,
];

export const updateSubAgentActivities = (
  activities: SubAgentActivity[],
  packet: AgentSubAgentEvent,
): SubAgentActivity[] => {
  const index = activities.findIndex(
    (activity) => activity.executionId === packet.execution_id,
  );
  const previous: SubAgentActivity =
    index >= 0
      ? activities[index]
      : {
          executionId: packet.execution_id,
          parentExecutionId: packet.parent_execution_id ?? null,
          subAgentId: packet.sub_agent_id,
          name: packet.sub_agent_name,
          modelName: null,
          depth: packet.depth,
          status: "running",
          content: "",
          thinking: "",
          toolCalls: [],
          toolResults: [],
        };

  // The name arrives once the child has resolved its fixed model binding.
  const base: SubAgentActivity = packet.model_name
    ? { ...previous, modelName: packet.model_name }
    : previous;
  let next = base;
  switch (packet.event.type) {
    case "start":
      next = { ...base, status: "running", error: undefined };
      break;
    case "delta":
      next = {
        ...base,
        status: "running",
        content: packet.event.content,
        thinking: packet.event.thinking,
      };
      break;
    case "tool_call":
      next = {
        ...base,
        status: "running",
        content: "",
        toolCalls: packet.event.tool_calls,
      };
      break;
    case "complete":
      next = {
        ...base,
        status: packet.event.tool_calls.length ? "running" : "completed",
        content: packet.event.content || base.content,
        thinking: packet.event.thinking || base.thinking,
        toolResults: mergeToolResults(
          base.toolResults,
          packet.event.tool_results,
        ),
      };
      break;
    case "error":
      next = {
        ...base,
        status: "error",
        error: packet.event.content,
      };
      break;
  }

  if (index < 0) return [...activities, next];
  return activities.map((activity, activityIndex) =>
    activityIndex === index ? next : activity,
  );
};
