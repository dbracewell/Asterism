import { AgentEventSchema } from "@/features/chat/schemas";
import { eventBus } from "@/features/sse/lib/event-bus";
import { ChatModel } from "@/lib/client";
import { zMessageModel } from "@/lib/client/zod.gen";
import React, { useMemo, useState } from "react";
import useWebSocket from "react-use-websocket";
import { z } from "zod";

export const useChatWebSocket = ({
  session,
  jwtToken,
}: {
  session: ChatModel;
  jwtToken: string;
}) => {
  const didUnmount = React.useRef(false);
  const streamingMessageRef = React.useRef<z.infer<
    typeof zMessageModel
  > | null>(null);
  const flushTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const [errorState, setErrorState] = useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      didUnmount.current = true;
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
      }
    };
  }, []);

  const { sendJsonMessage, readyState } = useWebSocket(
    `ws://${process.env.NEXT_PUBLIC_BACKEND_API_URL!.replace("http://", "")}/chat/stream/${session.info.id}?token=${jwtToken}`,
    {
      shouldReconnect: () => {
        return !didUnmount.current;
      },
      reconnectAttempts: 10,
      reconnectInterval: 3000,
      onMessage: (event) => {
        let raw_object;
        try {
          raw_object = JSON.parse(event.data);
        } catch (error) {
          console.error(error);
          return;
        }
        const result = AgentEventSchema.safeParse(raw_object);

        if (!result.success) {
          console.log(result.error.message);
          return;
        }

        const msgContent = result.data;

        if (msgContent.type === "error") {
          setErrorState(msgContent.content);
          return;
        }

        if (msgContent.type === "start") {
          streamingMessageRef.current = {
            model: { provider_id: "", name: "" },
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
          };

          eventBus.emit("chat-session:message-update", {
            markLastCompleted: true,
          });

          if (!flushTimerRef.current) {
            flushTimerRef.current = setInterval(() => {
              eventBus.emit("chat-session:message-update", {
                incomingMessage: streamingMessageRef.current,
              });
            }, 100);
          }
        }

        if (msgContent.type === "delta") {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            thinking: msgContent.thinking,
            content: msgContent.content,
          };
        }

        if (msgContent.type === "complete") {
          if (flushTimerRef.current) {
            clearInterval(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          eventBus.emit("chat-session:message-update", {
            updatedMessages: msgContent.last_messages,
            incomingMessage: null,
          });
          streamingMessageRef.current = null;
        }
      },
    },
  );

  return useMemo(
    () => ({
      errorState,
      sendJsonMessage,
      readyState,
    }),
    [errorState, readyState, sendJsonMessage],
  );
};
