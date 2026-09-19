import { AgentSubAgentEvent, ToolCallSchema } from "@/features/chat/schemas";
import { Message } from "@/lib/client";
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
  subAgentId: string;
  name: string;
  depth: number;
  status: "running" | "completed" | "error";
  content: string;
  thinking: string;
  toolCalls: z.infer<typeof ToolCallSchema>[];
  error?: string;
};

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
          subAgentId: packet.sub_agent_id,
          name: packet.sub_agent_name,
          depth: packet.depth,
          status: "running",
          content: "",
          thinking: "",
          toolCalls: [],
        };

  let next = previous;
  switch (packet.event.type) {
    case "start":
      next = { ...previous, status: "running", error: undefined };
      break;
    case "delta":
      next = {
        ...previous,
        status: "running",
        content: packet.event.content,
        thinking: packet.event.thinking,
      };
      break;
    case "tool_call":
      next = {
        ...previous,
        status: "running",
        content: "",
        toolCalls: packet.event.tool_calls,
      };
      break;
    case "complete":
      next = {
        ...previous,
        status: "completed",
        content: packet.event.content || previous.content,
        thinking: packet.event.thinking || previous.thinking,
      };
      break;
    case "error":
      next = {
        ...previous,
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
