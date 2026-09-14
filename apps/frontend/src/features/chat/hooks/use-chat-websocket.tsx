import { AgentEventSchema } from "@/features/chat/schemas";
import { StreamingMessage } from "@/features/chat/types";
import { Message } from "@/lib/client";
import React, { useMemo } from "react";
import useWebSocket from "react-use-websocket";

type UseChatWebSocketProps = {
  chatId: string;
  jwtToken: string;
  onStreamStart?: (message: Message) => void;
  onStreamUpdate?: (message: Message) => void;
  onStreamComplete?: (messages: Message[]) => void;
  onStreamError?: (error: string) => void;
  onRegenerate?: (parentId: string) => void;
  onStatusChange?: (isProcessing: boolean) => void;
};

const createPendingAssistantMessage = (): StreamingMessage => ({
  model_id: "",
  thinking: "",
  content: "",
  created_at: Math.floor(Date.now() / 1000),
  id: "incoming",
  role: "assistant",
  active_child_id: "",
  status: "pending",
  token_count: 0,
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
}: UseChatWebSocketProps) => {
  const didUnmount = React.useRef(false);
  const flushTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const streamingMessageRef = React.useRef<StreamingMessage | null>(null);
  const onStreamStartRef = React.useRef(onStreamStart);
  const onStreamUpdateRef = React.useRef(onStreamUpdate);
  const onStreamCompleteRef = React.useRef(onStreamComplete);
  const onStreamErrorRef = React.useRef(onStreamError);
  const onRegenerateRef = React.useRef(onRegenerate);
  const onStatusChangeRef = React.useRef(onStatusChange);
  const statusRef = React.useRef(false);

  React.useEffect(() => {
    onStreamStartRef.current = onStreamStart;
    onStreamUpdateRef.current = onStreamUpdate;
    onStreamCompleteRef.current = onStreamComplete;
    onStreamErrorRef.current = onStreamError;
    onRegenerateRef.current = onRegenerate;
    onStatusChangeRef.current = onStatusChange;
  }, [
    onStreamStart,
    onStreamUpdate,
    onStreamComplete,
    onStreamError,
    onRegenerate,
    onStatusChange,
  ]);

  React.useEffect(() => {
    return () => {
      didUnmount.current = true;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const wsEndpoint = useMemo(() => {
    const backendUrl = new URL(process.env.NEXT_PUBLIC_BACKEND_API_URL!);
    const wsUrl = new URL(`/api/py/chat/stream/${chatId}`, backendUrl);
    wsUrl.protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("token", jwtToken);
    return wsUrl.toString();
  }, [jwtToken, chatId]);

  const scheduleFlush = React.useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (streamingMessageRef.current != null) {
        onStreamUpdateRef.current?.(streamingMessageRef.current);
      }
    }, 50);
  }, []);

  const { sendJsonMessage, readyState } = useWebSocket(wsEndpoint, {
    shouldReconnect: () => {
      return !didUnmount.current;
    },
    reconnectAttempts: 10,
    reconnectInterval: 3000,
    heartbeat: {
      message: JSON.stringify({ type: "ping" }), // Message sent to the server
      interval: 30000, // Send every 30 seconds
      timeout: 10000, // Wait 10 seconds for a response
      returnMessage: "pong", // What the server returns to verify it's alive
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
        return;
      }

      const result = AgentEventSchema.safeParse(raw_object);

      if (!result.success) {
        console.log(result.error.message);
        return;
      }

      const msgContent = result.data;

      if (msgContent.type === "regenerate") {
        onRegenerateRef.current?.(msgContent.parent_id);
        return;
      }

      if (msgContent.type === "error") {
        onStreamErrorRef.current?.(msgContent.content);
        return;
      }

      if (msgContent.type === "start") {
        const pendingMessage = createPendingAssistantMessage();
        streamingMessageRef.current = pendingMessage;
        onStreamStartRef.current?.(pendingMessage);
        scheduleFlush();
      }

      if (msgContent.type === "tool_call") {
        if (streamingMessageRef.current == null) {
          streamingMessageRef.current = createPendingAssistantMessage();
        }

        if (streamingMessageRef.current != null) {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            tool_calls: msgContent.tool_calls,
          };
          onStreamUpdateRef.current?.(streamingMessageRef.current);
        }
      }

      if (msgContent.type === "tool_update") {
        if (streamingMessageRef.current == null) {
          streamingMessageRef.current = createPendingAssistantMessage();
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
          streamingMessageRef.current = createPendingAssistantMessage();
        }

        if (streamingMessageRef.current != null) {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            needsPermission: [
              ...(streamingMessageRef.current.needsPermission ?? []),
              msgContent,
            ],
          };
          onStreamUpdateRef.current?.(streamingMessageRef.current);
        }
      }

      if (msgContent.type === "delta") {
        if (streamingMessageRef.current == null) {
          streamingMessageRef.current = createPendingAssistantMessage();
        }

        streamingMessageRef.current = {
          ...streamingMessageRef.current!,
          thinking: msgContent.thinking,
          content: msgContent.content,
        };
        onStreamUpdateRef.current?.(streamingMessageRef.current);
      }

      if (msgContent.type === "complete") {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        onStreamCompleteRef.current?.(msgContent.last_messages);
        streamingMessageRef.current = null;
      }
    },
  });

  return useMemo(
    () => ({
      sendJsonMessage,
      readyState,
    }),
    [readyState, sendJsonMessage],
  );
};
