import {
  AgentEventSchema,
  AgentSubAgentEvent,
  ToolProgressEvent,
  CompactionPacket,
} from "@/features/chat/schemas";
import { ToolTimings } from "@/features/chat/lib/agent-timeline";
import {
  applyDelta,
  DeltaPacket,
  TextStreamState,
} from "@/features/chat/lib/text-stream";
import { StreamingMessage } from "@/features/chat/types";
import { backendToken, forgetBackendToken } from "@/lib/backend-token";
import { chatWebSocketUrl } from "@/lib/backend-url";
import { Message } from "@/lib/client";
import { ComparisonTag, parseComparisonTag } from "../lib/comparison";
import React, { useMemo } from "react";
import useWebSocket from "react-use-websocket";

/** How often the backend sends `{"type": "pong"}` (chat/connection.py). */
export const SERVER_PONG_INTERVAL_MS = 10_000;
/** Any message resets this; 2.5 server intervals leave room for a slow pong. */
export const HEARTBEAT_TIMEOUT_MS = SERVER_PONG_INTERVAL_MS * 2.5;

type UseChatWebSocketProps = {
  /** No connection is opened while this is null. */
  chatId: string | null;
  jwtToken: string;
  onStreamStart?: (message: StreamingMessage) => void;
  onStreamUpdate?: (message: StreamingMessage) => void;
  /** `comparison` is set when the run answered a comparison column (US-54.4). */
  onStreamComplete?: (messages: Message[], comparison?: ComparisonTag) => void;
  onStreamError?: (
    error: string,
    code?: string | null,
    comparison?: ComparisonTag,
  ) => void;
  onRegenerate?: (parentId: string) => void;
  onStatusChange?: (isProcessing: boolean) => void;
  onSubAgentEvent?: (event: AgentSubAgentEvent) => void;
  /** Context compaction progress, automatic or requested (ADR-0060). */
  onCompaction?: (packet: CompactionPacket) => void;
};

const createPendingAssistantMessage = (
  comparison?: ComparisonTag,
): StreamingMessage => ({
  ...(comparison ? { comparison } : {}),
  model_id: "",
  thinking: "",
  content: "",
  created_at: Math.floor(Date.now() / 1000),
  id: "incoming",
  role: "assistant",
  active_child_id: "",
  status: "pending",
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  tool_calls: [],
  has_siblings: false,
  current_sibling_index: 1,
  sibling_count: 1,
  needsPermission: [],
});

export const useChatWebSocket = ({
  chatId,
  jwtToken,
  onStreamStart,
  onStreamUpdate,
  onStreamComplete,
  onStreamError,
  onRegenerate,
  onStatusChange,
  onSubAgentEvent,
  onCompaction,
}: UseChatWebSocketProps) => {
  const [activeToken, setActiveToken] = React.useState(jwtToken);
  const [toolTimings, setToolTimings] = React.useState<ToolTimings>({});
  // The latest progress report of the tool now running; cleared as the turn moves on.
  const [toolProgress, setToolProgress] =
    React.useState<ToolProgressEvent | null>(null);
  const didUnmount = React.useRef(false);
  const flushTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const streamingMessageRef = React.useRef<StreamingMessage | null>(null);
  // ADR-0084: the reply's open text stream and each running sub-agent's.
  const mainStreamRef = React.useRef<TextStreamState | null>(null);
  const childStreamsRef = React.useRef(new Map<string, TextStreamState>());
  const sendRef = React.useRef<((message: unknown) => void) | null>(null);
  const onStreamStartRef = React.useRef(onStreamStart);
  const onStreamUpdateRef = React.useRef(onStreamUpdate);
  const onStreamCompleteRef = React.useRef(onStreamComplete);
  const onStreamErrorRef = React.useRef(onStreamError);
  const onRegenerateRef = React.useRef(onRegenerate);
  const onStatusChangeRef = React.useRef(onStatusChange);
  const onSubAgentEventRef = React.useRef(onSubAgentEvent);
  const onCompactionRef = React.useRef(onCompaction);
  const statusRef = React.useRef(false);

  React.useEffect(() => {
    setActiveToken(jwtToken);
  }, [jwtToken]);

  React.useEffect(() => {
    onStreamStartRef.current = onStreamStart;
    onStreamUpdateRef.current = onStreamUpdate;
    onStreamCompleteRef.current = onStreamComplete;
    onStreamErrorRef.current = onStreamError;
    onRegenerateRef.current = onRegenerate;
    onStatusChangeRef.current = onStatusChange;
    onSubAgentEventRef.current = onSubAgentEvent;
    onCompactionRef.current = onCompaction;
  }, [
    onStreamStart,
    onStreamUpdate,
    onStreamComplete,
    onStreamError,
    onRegenerate,
    onStatusChange,
    onSubAgentEvent,
    onCompaction,
  ]);

  React.useEffect(() => {
    return () => {
      didUnmount.current = true;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const refreshToken = React.useCallback(async (rejected: boolean) => {
    try {
      // 1008 is the backend refusing the token; any other close keeps it.
      if (rejected) forgetBackendToken();
      const token = await backendToken();
      if (!didUnmount.current && token) {
        setActiveToken(token);
      }
    } catch {
      // Keep the existing token if the refresh endpoint is unreachable.
    }
  }, []);

  const wsEndpoint = useMemo(() => {
    if (typeof window === "undefined" || chatId === null) return null;
    return chatWebSocketUrl(window.location.origin, chatId, activeToken);
  }, [activeToken, chatId]);

  const scheduleFlush = React.useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (streamingMessageRef.current != null) {
        onStreamUpdateRef.current?.(streamingMessageRef.current);
      }
    }, 50);
  }, []);

  const resetTextStreams = () => {
    mainStreamRef.current = null;
    childStreamsRef.current.clear();
  };

  /** Apply one numbered packet; asks for the text so far after a gap. */
  const applyStreamDelta = (
    state: TextStreamState | null,
    packet: DeltaPacket,
  ) => {
    const result = applyDelta(state, packet);
    if (result.resync) sendRef.current?.({ type: "resync" });
    return result;
  };

  const { sendJsonMessage, readyState } = useWebSocket(wsEndpoint, {
    shouldReconnect: () => {
      return !didUnmount.current;
    },
    onClose: (event) => {
      setToolProgress(null);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (statusRef.current) {
        statusRef.current = false;
        onStatusChangeRef.current?.(false);
      }
      streamingMessageRef.current = null;
      resetTextStreams();
      if (!didUnmount.current) {
        void refreshToken(event.code === 1008);
      }
    },
    onError: () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (statusRef.current) {
        statusRef.current = false;
        onStatusChangeRef.current?.(false);
      }
      streamingMessageRef.current = null;
      resetTextStreams();
    },
    reconnectAttempts: 10,
    reconnectInterval: 3000,
    // The server sends a pong every SERVER_PONG_INTERVAL_MS; the connection is
    // dropped only after missing more than two (US-117.2).
    heartbeat: {
      message: JSON.stringify({ type: "ping" }),
      interval: 30000,
      timeout: HEARTBEAT_TIMEOUT_MS,
      returnMessage: "pong",
    },
    onMessage: (event) => {
      let raw_object;
      try {
        raw_object = JSON.parse(event.data);
      } catch (error) {
        console.error(error);
        return;
      }

      if (raw_object["type"] === "pong") {
        return;
      }

      if (raw_object["type"] === "status") {
        if (statusRef.current !== raw_object["is_processing"]) {
          statusRef.current = raw_object["is_processing"];
          onStatusChangeRef.current?.(raw_object["is_processing"]);
        }
        if (!raw_object["is_processing"]) setToolProgress(null);
        return;
      }

      const result = AgentEventSchema.safeParse(raw_object);

      // An event this client doesn't know is ignored; its text may quote the chat.
      if (!result.success) return;

      const msgContent = result.data;
      // Comparison runs tag every packet with their column.
      const comparison = parseComparisonTag(raw_object["comparison"]);
      // A run may begin with an untagged start; its tagged packets claim it.
      if (
        comparison &&
        streamingMessageRef.current &&
        !streamingMessageRef.current.comparison
      )
        streamingMessageRef.current = {
          ...streamingMessageRef.current,
          comparison,
        };

      if (msgContent.type === "sub_agent") {
        const child = msgContent.event;
        if (child.type === "delta") {
          const streams = childStreamsRef.current;
          const result = applyStreamDelta(
            streams.get(msgContent.execution_id) ?? null,
            child,
          );
          streams.set(msgContent.execution_id, result.state);
          if (!result.changed) return;
          // Activities show the child's whole text, as a `replace` carries it.
          onSubAgentEventRef.current?.({
            ...msgContent,
            event: {
              ...child,
              mode: "replace",
              content: result.state.content,
              thinking: result.state.thinking,
            },
          });
          return;
        }
        if (child.type === "complete" || child.type === "error")
          childStreamsRef.current.delete(msgContent.execution_id);
        onSubAgentEventRef.current?.(msgContent);
        return;
      }

      if (msgContent.type === "tool_progress") {
        setToolProgress(msgContent);
        return;
      }
      // Any other step of the turn ends the progress shown for the last tool.
      if (msgContent.type !== "compaction") setToolProgress(null);

      if (msgContent.type === "compaction") {
        onCompactionRef.current?.(msgContent);
        return;
      }

      if (msgContent.type === "regenerate") {
        onRegenerateRef.current?.(msgContent.parent_id);
        return;
      }

      if (msgContent.type === "error") {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        if (statusRef.current) {
          statusRef.current = false;
          onStatusChangeRef.current?.(false);
        }
        streamingMessageRef.current = null;
        resetTextStreams();
        onStreamErrorRef.current?.(
          msgContent.content,
          msgContent.error_code,
          comparison,
        );
        return;
      }

      if (msgContent.type === "start") {
        const pendingMessage = {
          ...createPendingAssistantMessage(comparison),
          execution: msgContent.execution,
          model_id: msgContent.execution?.model.id,
          // Lets mode-specific rendering (Explain-back feedback) apply while streaming.
          learning_mode: msgContent.execution?.learning_mode,
        };
        streamingMessageRef.current = pendingMessage;
        onStreamStartRef.current?.(pendingMessage);
      }

      if (msgContent.type === "tool_call") {
        const startedAt = Date.now();
        setToolTimings((timings) => {
          const next = { ...timings };
          for (const call of msgContent.tool_calls) {
            next[call.id] ??= { startedAt };
          }
          return next;
        });
        if (streamingMessageRef.current == null) {
          streamingMessageRef.current =
            createPendingAssistantMessage(comparison);
        }

        if (streamingMessageRef.current != null) {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            content: "",
            tool_calls: msgContent.tool_calls,
          };
          onStreamUpdateRef.current?.(streamingMessageRef.current);
        }
      }

      if (msgContent.type === "tool_update") {
        if (streamingMessageRef.current == null) {
          streamingMessageRef.current =
            createPendingAssistantMessage(comparison);
          return;
        }
        if (streamingMessageRef.current != null) {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            needsPermission:
              streamingMessageRef.current.needsPermission?.filter(
                (t) => t.id !== msgContent.id,
              ),
          };
          onStreamUpdateRef.current?.(streamingMessageRef.current);
        }
      }

      if (msgContent.type === "tool_permission_request") {
        if (streamingMessageRef.current == null) {
          streamingMessageRef.current =
            createPendingAssistantMessage(comparison);
        }

        const pending = streamingMessageRef.current.needsPermission ?? [];
        if (!pending.some((request) => request.id === msgContent.id)) {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            needsPermission: [
              ...pending,
              {
                id: msgContent.id,
                name: msgContent.name,
                arguments: msgContent.arguments,
              },
            ],
          };
          onStreamUpdateRef.current?.(streamingMessageRef.current);
        }
      }

      if (msgContent.type === "delta") {
        if (streamingMessageRef.current == null) {
          streamingMessageRef.current =
            createPendingAssistantMessage(comparison);
        }

        const result = applyStreamDelta(mainStreamRef.current, msgContent);
        mainStreamRef.current = result.state;
        if (!result.changed) return;
        streamingMessageRef.current = {
          ...streamingMessageRef.current!,
          thinking: result.state.thinking,
          content: result.state.content,
        };
        scheduleFlush();
      }

      if (msgContent.type === "complete") {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        const endedAt = Date.now();
        setToolTimings((timings) => {
          let next = timings;
          for (const message of msgContent.last_messages) {
            for (const result of message.tool_call_results ?? []) {
              const timing = timings[result.tool_call.id];
              if (timing && timing.endedAt == null) {
                next = {
                  ...next,
                  [result.tool_call.id]: { ...timing, endedAt },
                };
              }
            }
          }
          return next;
        });
        onStreamCompleteRef.current?.(
          msgContent.last_messages,
          comparison ?? streamingMessageRef.current?.comparison,
        );
        streamingMessageRef.current = null;
        // The step's text is saved; the next step streams on a new stream.
        mainStreamRef.current = null;
      }
    },
  });

  React.useEffect(() => {
    sendRef.current = sendJsonMessage;
  }, [sendJsonMessage]);

  return useMemo(
    () => ({
      sendJsonMessage,
      readyState,
      toolTimings,
      toolProgress,
    }),
    [readyState, sendJsonMessage, toolTimings, toolProgress],
  );
};
