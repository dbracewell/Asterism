"use client";
import { useUser } from "@/features/auth/components/user-context";
import { AgentTimeline } from "@/features/chat/components/agent-timeline";
import { DelegationSummary } from "@/features/chat/components/delegation-summary";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
import { RetrievalCitations } from "@/features/chat/components/retrieval-citations";
import { ToolApprovalCards } from "@/features/chat/components/tool-approval-cards";
import {
  ToolTimings,
  messageTimelineSteps,
} from "@/features/chat/lib/agent-timeline";
import { PermissionRequest, StreamingMessage } from "@/features/chat/types";
import type { DelegationRecord, Message } from "@/lib/client";
import { cn } from "@/lib/utils";
import React from "react";
import { SendJsonMessage } from "react-use-websocket/dist/lib/types";
import { MessageActions } from "./message-actions";
import { MessageBody } from "./message-body";
import { InlineFilesProvider } from "@/components/markdown-viewer/inline-files";
import { MessageMarker } from "./message-marker";
import { MessageMeta } from "./message-meta";
import { TurnInspection } from "./turn-inspection";
import { VerificationPanel } from "@/features/chat/components/verification/verification-panel";
import { ExerciseBar } from "@/features/chat/components/exercise/exercise-bar";
import { DraftReviewButton } from "@/features/chat/components/draft-review/draft-review";
import { StreamingIndicator } from "./streaming-indicator";

const NO_REQUESTS: PermissionRequest[] = [];

/**
 * One transcript entry: an assistant column with a marker, or a right-aligned
 * user bubble. Metadata stays quiet until the message is hovered or holds
 * focus, and is always shown on coarse (touch) pointers.
 */
export const MessageItem = React.memo(
  ({
    chatId,
    isProcessing,
    message,
    startsTurn,
    streaming = false,
    toolTimings,
    turnSteps,
    turnRequest,
    canRegenerate,
    onRegenerate,
    onCompare,
    onFork,
    sendJsonMessage,
  }: {
    chatId: string;
    isProcessing: boolean;
    message: StreamingMessage;
    /** First assistant message after a user message; carries the marker. */
    startsTurn: boolean;
    /** The live message; its timeline opens when the user shows thinking. */
    streaming?: boolean;
    toolTimings?: ToolTimings;
    /** The turn's assistant steps when this is its settled final step. */
    turnSteps?: Message[] | null;
    /** The user turn `turnSteps` answer, for diffing branches (US-54.6). */
    turnRequest?: Message | null;
    canRegenerate: boolean;
    onRegenerate: (parentId?: string | null) => void;
    onCompare?: () => void;
    /** Fork the run from one of this step's delegations (US-54.5). */
    onFork?: (record: DelegationRecord) => void;
    sendJsonMessage: SendJsonMessage;
  }) => {
    const user = useUser();
    const answerRef = React.useRef<HTMLDivElement>(null);
    const fromUser = message.role === "user";
    const showThinking = user.settings.show_thinking ?? false;
    const steps = React.useMemo(
      () =>
        messageTimelineSteps(message, {
          showThinking,
          timings: toolTimings,
        }),
      [message, showThinking, toolTimings],
    );
    const settled =
      message.tool_calls == null &&
      (message.status === "completed" || message.status === "cancelled");

    return (
      <article
        aria-label={fromUser ? "Your message" : "Assistant message"}
        data-role={fromUser ? "user" : "assistant"}
        className={cn(
          "group/message mb-5 flex min-w-0 gap-3 wrap-anywhere",
          !!message.tool_calls && "mb-0!",
        )}
      >
        {!fromUser && <MessageMarker visible={startsTurn} />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <InlineFilesProvider
            value={{
              chatId,
              // A streaming step has no server-resolved list yet (ADR-0039 §5).
              files:
                !fromUser && message.status === "pending"
                  ? null
                  : (message.inline_files ?? []),
              citations:
                !fromUser && message.status === "pending"
                  ? null
                  : (message.citations ?? []),
            }}
          >
            <AgentTimeline
              steps={steps}
              streaming={streaming}
              defaultOpen={streaming && showThinking}
            />
            {!!message.delegations?.length && (
              <DelegationSummary
                records={message.delegations}
                mainModel={message.execution?.model.name}
                disagreements={
                  message.status === "pending"
                    ? undefined
                    : {
                        chatId,
                        messageId: message.id,
                        summary: message.disagreements,
                        preferredModelId: message.execution?.model.id,
                      }
                }
                onFork={onFork}
              />
            )}
            <ToolApprovalCards
              requests={message.needsPermission ?? NO_REQUESTS}
              onDecide={(request, approved) =>
                sendJsonMessage({
                  type: "tool_approval",
                  tool_id: request.id,
                  approved,
                })
              }
            />
            <div ref={answerRef} className="contents">
              <MessageBody message={message} />
            </div>
          </InlineFilesProvider>
          {!fromUser && message.exercise && (
            <ExerciseBar
              chatId={chatId}
              messageId={message.id}
              exercise={message.exercise}
              answerRef={answerRef}
            />
          )}
          {!fromUser && message.draft_comment_summary && (
            <DraftReviewButton
              chatId={chatId}
              messageId={message.id}
              summary={message.draft_comment_summary}
            />
          )}
          {!fromUser && message.verification && (
            <VerificationPanel
              chatId={chatId}
              messageId={message.id}
              verification={message.verification}
              answerRef={answerRef}
            />
          )}
          {!!message.tool_call_results?.length && (
            <RetrievalCitations
              chatId={chatId}
              results={message.tool_call_results}
            />
          )}
          {fromUser && message.files && (
            <MessageAttachments chatId={chatId} files={message.files} />
          )}
          {!fromUser && message.status === "pending" && <StreamingIndicator />}
          {settled && (
            <footer
              className={cn(
                "text-muted-foreground text-meta flex w-fit max-w-full flex-wrap items-center gap-1",
                fromUser && "ml-auto flex-row-reverse",
              )}
            >
              <MessageActions
                chatId={chatId}
                message={message}
                isProcessing={isProcessing}
                canRegenerate={canRegenerate}
                onRegenerate={onRegenerate}
                onCompare={onCompare}
              />
              <span className="opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100">
                <MessageMeta message={message} />
                {!fromUser && turnSteps && (
                  <TurnInspection
                    chatId={chatId}
                    steps={turnSteps}
                    request={turnRequest}
                  />
                )}
              </span>
            </footer>
          )}
        </div>
      </article>
    );
  },
);
MessageItem.displayName = "MessageItem";
