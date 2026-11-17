"use client";

import { MessageItem } from "@/features/chat/components/message/message-item";
import { StreamingIndicator } from "@/features/chat/components/message/streaming-indicator";
import { SubAgentActivityPanel } from "@/features/chat/components/sub-agent-activity";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import { StreamingMessage, SubAgentActivity } from "@/features/chat/types";
import { Chat, ChatCompactionView, DelegationRecord } from "@/lib/client";
import React from "react";
import { groupTranscript } from "../lib/comparison";
import { turnStepsEndingAt } from "../lib/run-usage";
import { CompactionDivider } from "./compaction-divider";
import { ComparisonBlock } from "./comparison-block";
import { ImageProgressStatus } from "./image-progress-status";

type ChatSocket = ReturnType<typeof useChatWebSocket>;

/**
 * The conversation's messages and comparison blocks, compaction dividers,
 * progress indicators and the reply streaming in.
 */
export function ChatTranscript({
  chatId,
  session,
  incomingMessage,
  comparisonStream,
  subAgentActivities,
  isProcessing,
  isCompacting,
  awaitingReply,
  interactionBusy,
  canRegenerate,
  onRegenerate,
  compareAction,
  forkAction,
  toolTimings,
  toolProgress,
  sendJsonMessage,
}: {
  chatId: string;
  session: Chat;
  incomingMessage: StreamingMessage | null;
  comparisonStream: StreamingMessage | null;
  subAgentActivities: SubAgentActivity[];
  isProcessing: boolean;
  isCompacting: boolean;
  /** A reply is owed but nothing has streamed yet. */
  awaitingReply: boolean;
  interactionBusy: boolean;
  canRegenerate: boolean;
  onRegenerate: (parentId?: string | null) => void;
  compareAction: (index: number) => (() => void) | undefined;
  forkAction: (
    index: number,
  ) => ((record: DelegationRecord) => void) | undefined;
  toolTimings: ChatSocket["toolTimings"];
  toolProgress: ChatSocket["toolProgress"];
  sendJsonMessage: ChatSocket["sendJsonMessage"];
}) {
  // Each settled final step's turn, for its usage summary (US-54.1).
  const turnSteps = React.useMemo(
    () =>
      session.messages.map((_, index, messages) =>
        turnStepsEndingAt(messages, index),
      ),
    [session.messages],
  );
  // Dividers sit after the last message each summary replaced.
  const compactionsByAnchor = new Map<string, ChatCompactionView[]>();
  for (const compaction of session.compactions ?? []) {
    const list = compactionsByAnchor.get(compaction.through_message_id) ?? [];
    compactionsByAnchor.set(compaction.through_message_id, [
      ...list,
      compaction,
    ]);
  }
  const lastMessage = session.messages.at(-1);

  return (
    <div className="mx-auto w-full max-w-5xl">
      {groupTranscript(session.messages).map((item) =>
        item.kind === "comparison" ? (
          <ComparisonBlock
            key={item.comparisonId}
            chatId={chatId}
            comparisonId={item.comparisonId}
            stream={comparisonStream}
            isProcessing={interactionBusy}
            canRegenerate={canRegenerate}
            onRegenerate={onRegenerate}
            toolTimings={toolTimings}
            sendJsonMessage={sendJsonMessage}
          />
        ) : (
          <React.Fragment key={item.message.id}>
            <MessageItem
              chatId={chatId}
              message={item.message}
              startsTurn={
                session.messages[item.index - 1]?.role !== "assistant"
              }
              isProcessing={interactionBusy}
              canRegenerate={canRegenerate}
              onRegenerate={onRegenerate}
              onCompare={compareAction(item.index)}
              onFork={forkAction(item.index)}
              toolTimings={toolTimings}
              turnSteps={turnSteps[item.index]}
              turnRequest={
                turnSteps[item.index]
                  ? session.messages[
                      item.index - (turnSteps[item.index]?.length ?? 0)
                    ]
                  : null
              }
              sendJsonMessage={sendJsonMessage}
            />
            {compactionsByAnchor.get(item.message.id)?.map((compaction) => (
              <CompactionDivider key={compaction.id} compaction={compaction} />
            ))}
          </React.Fragment>
        ),
      )}

      {isCompacting ? (
        <StreamingIndicator variant="turn" label="Compacting conversation…" />
      ) : (
        awaitingReply &&
        (lastMessage?.role === "assistant" ? (
          // Between agent steps: trail the turn under its existing marker.
          <div className="mb-5 pl-10">
            <StreamingIndicator />
          </div>
        ) : (
          <StreamingIndicator variant="turn" />
        ))
      )}
      {isProcessing && <ImageProgressStatus progress={toolProgress} />}
      <SubAgentActivityPanel
        activities={subAgentActivities}
        mainModel={session.info.selected_model?.name}
      />
      {incomingMessage && (
        <MessageItem
          chatId={chatId}
          message={incomingMessage}
          startsTurn={lastMessage?.role !== "assistant"}
          isProcessing={interactionBusy}
          canRegenerate={false}
          onRegenerate={onRegenerate}
          streaming
          toolTimings={toolTimings}
          sendJsonMessage={sendJsonMessage}
        />
      )}
    </div>
  );
}
