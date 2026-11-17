import { invalidateComparisons } from "@/features/chat/components/comparison-block";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import {
  StreamingMessage,
  SubAgentActivity,
  updateSubAgentActivities,
} from "@/features/chat/types";
import { client } from "@/lib/api";
import { Chat, Message } from "@/lib/client";
import {
  chatSessionGetOneOptions,
  chatSessionGetOneQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";

export type SocketError = { message: string; code?: string | null };

/**
 * A chat's live run over its websocket: the streaming reply, comparison
 * column, sub-agent activity, compaction and errors, kept in step with the
 * cached chat.
 */
export function useChatStream({
  chatId,
  jwtToken,
  refetch,
  onStreamStart,
}: {
  chatId: string;
  jwtToken: string;
  refetch: () => unknown;
  /** A new reply began streaming. */
  onStreamStart: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = chatSessionGetOneQueryKey({ path: { chat_id: chatId } });
  const [incomingMessage, setIncomingMessage] =
    React.useState<StreamingMessage | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  // US-54.4: a run answering a comparison column streams into its column.
  const [comparisonStream, setComparisonStream] =
    React.useState<StreamingMessage | null>(null);
  const [subAgentActivities, setSubAgentActivities] = React.useState<
    SubAgentActivity[]
  >([]);
  // ADR-0060: a compaction (automatic or requested) is running.
  const [isCompacting, setIsCompacting] = React.useState(false);
  const [socketError, setSocketError] = React.useState<SocketError | null>(
    null,
  );

  const { sendJsonMessage, readyState, toolTimings, toolProgress } =
    useChatWebSocket({
      chatId,
      jwtToken,
      onStatusChange: (isProcessing) => {
        setIsProcessing(isProcessing);
        if (!isProcessing) setIsCompacting(false);
      },
      onStreamStart: (pendingMessage) => {
        onStreamStart();
        setIsCompacting(false);
        if (pendingMessage.comparison) {
          setIncomingMessage(null);
          setComparisonStream(pendingMessage);
          return;
        }
        setIncomingMessage(pendingMessage);
        queryClient.setQueryData(queryKey, (prev?: Chat) => {
          if (!prev || prev.messages.length === 0) return prev;
          const last = prev.messages[prev.messages.length - 1];
          if (last.status === "completed") return prev;
          return {
            ...prev,
            messages: [
              ...prev.messages.slice(0, -1),
              { ...last, status: "completed" },
            ],
          };
        });
      },
      onStreamError: (error, code, comparison) => {
        setIsProcessing(false);
        setIsCompacting(false);
        setIncomingMessage(null);
        setComparisonStream(null);
        if (comparison) void invalidateComparisons(queryClient);
        setSocketError({ message: error, code });
      },
      onRegenerate: () => {
        refetch();
      },
      onStreamUpdate: (nextIncomingMessage) => {
        if (nextIncomingMessage.comparison) {
          // Never also render a column's run at the end of the transcript.
          setIncomingMessage(null);
          setComparisonStream(nextIncomingMessage);
          return;
        }
        setIncomingMessage(nextIncomingMessage);
      },
      onSubAgentEvent: (packet) => {
        setSubAgentActivities((activities) =>
          updateSubAgentActivities(activities, packet),
        );
      },
      onCompaction: (packet) => {
        if (packet.status === "started") {
          setIsCompacting(true);
          return;
        }
        setIsCompacting(false);
        if (packet.status === "failed") {
          setSocketError({
            message:
              packet.content ?? "The conversation could not be compacted.",
          });
          return;
        }
        const compaction = packet.compaction;
        if (!compaction) return;
        queryClient.setQueryData(queryKey, (prev?: Chat) =>
          prev
            ? {
                ...prev,
                compactions: [
                  ...(prev.compactions ?? []).filter(
                    (item) => item.id !== compaction.id,
                  ),
                  compaction,
                ],
              }
            : prev,
        );
        // The context meter now counts the summary instead.
        queryClient.invalidateQueries({ queryKey });
      },
      onStreamComplete: (updatedMessages, comparison) => {
        if (comparison) {
          // Columns run one after another; the next column's start follows.
          setComparisonStream(null);
          setIncomingMessage(null);
          setSubAgentActivities([]);
          void invalidateComparisons(queryClient);
          queryClient.invalidateQueries({ queryKey });
          return;
        }
        setIsProcessing(false);
        setIncomingMessage(null);
        if (!updatedMessages.length) return;
        setSubAgentActivities([]);
        queryClient.invalidateQueries({ queryKey });
        queryClient.setQueryData(queryKey, (prev?: Chat) => {
          if (!prev) return;
          const index = prev.messages.findLastIndex((m) => {
            return m.id === updatedMessages[0].id;
          });
          let new_messages: Message[];
          if (index >= 0) {
            new_messages = [
              ...prev.messages.slice(0, index),
              ...updatedMessages,
            ];
          } else {
            new_messages = [...prev.messages, ...updatedMessages];
          }

          return { ...prev, messages: new_messages };
        });
      },
    });

  /**
   * Reads the accepted branch state, then resumes the pending turn it ends
   * with. Persistence acknowledgement precedes generation, so a reconnect can
   * resume the same turn.
   */
  const resume = async () => {
    await queryClient.fetchQuery({
      ...chatSessionGetOneOptions({ client, path: { chat_id: chatId } }),
      staleTime: 0,
    });
    setSubAgentActivities([]);
    setIsProcessing(true);
    sendJsonMessage({ type: "resume" });
  };

  return {
    sendJsonMessage,
    readyState,
    toolTimings,
    toolProgress,
    incomingMessage,
    setIncomingMessage,
    isProcessing,
    setIsProcessing,
    comparisonStream,
    subAgentActivities,
    isCompacting,
    setIsCompacting,
    socketError,
    setSocketError,
    resume,
  };
}
