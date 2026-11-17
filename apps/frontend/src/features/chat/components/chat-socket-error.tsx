"use client";

import { Button } from "@/components/ui/button";
import {
  isPlanErrorCode,
  PlanRecoveryNotice,
} from "@/features/chatgpt/components/plan-usage";
import type { SocketError } from "@/features/chat/hooks/use-chat-stream";
import { XIcon } from "lucide-react";

/** A run's error above the composer; plan errors get their recovery notice. */
export function ChatSocketError({
  error,
  onDismiss,
}: {
  error: SocketError;
  onDismiss: () => void;
}) {
  if (isPlanErrorCode(error.code))
    return (
      <PlanRecoveryNotice
        code={error.code}
        message={error.message}
        onDismiss={onDismiss}
        className="mx-auto mb-2 max-w-5xl"
      />
    );
  return (
    <div
      role="alert"
      className="bg-destructive/10 border-destructive text-destructive rounded-surface mx-auto mb-2 flex w-full max-w-5xl items-center justify-between gap-2 border px-3 py-2 text-sm"
    >
      <p className="min-w-0 flex-1">{error.message}</p>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="text-destructive hover:bg-destructive/20 h-6 w-6 shrink-0"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
