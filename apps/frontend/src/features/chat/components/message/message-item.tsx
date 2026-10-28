"use client";
import { Button } from "@/components/ui/button";
import { useUser } from "@/features/auth/components/user-context";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
import { RetrievalCitations } from "@/features/chat/components/retrieval-citations";
import { StreamingMessage } from "@/features/chat/types";
import { cn } from "@/lib/utils";
import React from "react";
import { SendJsonMessage } from "react-use-websocket/dist/lib/types";
import { MessageActions } from "./message-actions";
import { MessageBody } from "./message-body";
import { MessageLoading } from "./message-loading";
import { MessageMarker } from "./message-marker";
import { MessageMeta } from "./message-meta";
import { MessageThinking } from "./message-thinking";

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
    defaultShowThinking = false,
    canRegenerate,
    onRegenerate,
    sendJsonMessage,
  }: {
    chatId: string;
    isProcessing: boolean;
    message: StreamingMessage;
    /** First assistant message after a user message; carries the marker. */
    startsTurn: boolean;
    defaultShowThinking?: boolean;
    canRegenerate: boolean;
    onRegenerate: (parentId?: string | null) => void;
    sendJsonMessage: SendJsonMessage;
  }) => {
    const user = useUser();
    const fromUser = message.role === "user";
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
          {(user.settings.show_thinking ?? false) && (
            <MessageThinking
              message={message}
              defaultOpen={defaultShowThinking}
            />
          )}
          {message.needsPermission?.map((t) => (
            <div key={t.id}>
              {t.name} {t.arguments}{" "}
              <Button
                onClick={() =>
                  sendJsonMessage({
                    type: "tool_approval",
                    tool_id: t.id,
                    approved: true,
                  })
                }
              >
                Approve
              </Button>
            </div>
          ))}
          <MessageBody message={message} />
          {!!message.tool_call_results?.length && (
            <RetrievalCitations
              chatId={chatId}
              results={message.tool_call_results}
            />
          )}
          {fromUser && message.files && (
            <MessageAttachments chatId={chatId} files={message.files} />
          )}
          {!fromUser && message.status === "pending" && <MessageLoading />}
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
              />
              <span className="opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100">
                <MessageMeta message={message} />
              </span>
            </footer>
          )}
        </div>
      </article>
    );
  },
);
MessageItem.displayName = "MessageItem";
