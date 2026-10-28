"use client";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { StreamingMessage } from "@/features/chat/types";
import { client } from "@/lib/api";
import { messageUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, RotateCwIcon } from "lucide-react";

export const MessageActions = ({
  chatId,
  message,
  isProcessing,
  canRegenerate,
  onRegenerate,
}: {
  chatId: string;
  message: StreamingMessage;
  isProcessing: boolean;
  canRegenerate: boolean;
  onRegenerate: (parentId?: string | null) => void;
}) => {
  const updateMessage = useMutation({ ...messageUpdateMutation({ client }) });
  const nodeIndex = message.current_sibling_index ?? 1;
  const nodeCount = message.sibling_count ?? 1;
  const showSibling = (siblingId: string | null) =>
    updateMessage.mutate({
      path: { chat_id: chatId, message_id: message.parent_message_id! },
      body: { active_child_id: siblingId },
    });

  return (
    <span data-slot="message-actions" className="flex items-center">
      {nodeCount > 1 && (
        <span className="flex items-center tabular-nums">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-control"
            onClick={() => showSibling(message.previous_sibling_id ?? null)}
            aria-label="Previous response version"
            disabled={message.previous_sibling_id == null || isProcessing}
          >
            <ChevronLeftIcon />
          </Button>
          {nodeIndex} / {nodeCount}
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-control"
            onClick={() => showSibling(message.next_sibling_id ?? null)}
            aria-label="Next response version"
            disabled={message.next_sibling_id == null || isProcessing}
          >
            <ChevronRightIcon />
          </Button>
        </span>
      )}
      {message.role !== "user" && (
        <Hint hint="Regenerate">
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-control"
            aria-label="Regenerate response"
            disabled={isProcessing || !canRegenerate}
            onClick={() => onRegenerate(message.parent_message_id)}
          >
            <RotateCwIcon />
          </Button>
        </Hint>
      )}
      <CopyButton
        text={message.content}
        size="icon-sm"
        className="rounded-control"
      />
    </span>
  );
};
