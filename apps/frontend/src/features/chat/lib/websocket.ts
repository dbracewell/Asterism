import useWebSocket from "react-use-websocket";
import { ChatModel } from "@/lib/client";
import React, { useMemo, useState } from "react";
import { eventBus } from "@/features/sse/lib/event-bus";
import { zMessageModel } from "@/lib/client/zod.gen";
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
        const msgContent = JSON.parse(event.data);

        if (msgContent.type === "ERROR") {
          setErrorState(msgContent.message);
        }

        if (msgContent.type === "STREAM_START") {
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

        if (msgContent.type === "THINKING_DELTA") {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            thinking: msgContent.content,
          };
        }

        if (msgContent.type === "TEXT_DELTA") {
          streamingMessageRef.current = {
            ...streamingMessageRef.current!,
            content: msgContent.content,
          };
        }

        if (
          msgContent.type === "STREAM_END" ||
          msgContent.type === "STREAM_PRE_TOOLS"
        ) {
          if (flushTimerRef.current) {
            clearInterval(flushTimerRef.current);
            flushTimerRef.current = null;
          }

          const lastMessages = JSON.parse(msgContent.content) as z.infer<
            typeof zMessageModel
          >[];
          eventBus.emit("chat-session:message-update", {
            updatedMessages: lastMessages,
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
