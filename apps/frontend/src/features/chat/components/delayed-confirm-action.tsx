"use client";

import { AlertDialogAction } from "@/components/ui/alert-dialog";
import type { ChatInfo } from "@/lib/client";
import React from "react";

/** Seconds a locked chat waits before an override can be confirmed. */
export const LOCK_OVERRIDE_DELAY_SECONDS = 5;

/** Counts down once a second from `seconds` after mount. */
function useCountdown(seconds: number) {
  const [remaining, setRemaining] = React.useState(seconds);
  const done = remaining <= 0;
  React.useEffect(() => {
    if (done) return;
    const timer = window.setInterval(
      () => setRemaining((r) => Math.max(r - 1, 0)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [done]);
  return remaining;
}

/**
 * An alert-dialog action that becomes available after a short delay. The
 * dialog content mounts on open, so each opening restarts the wait.
 */
export function DelayedConfirmAction({
  delaySeconds,
  disabled = false,
  onConfirm,
  children,
}: {
  delaySeconds: number;
  disabled?: boolean;
  onConfirm: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: string;
}) {
  const remaining = useCountdown(delaySeconds);
  const waiting = remaining > 0;
  return (
    <AlertDialogAction
      disabled={disabled || waiting}
      onClick={onConfirm}
      data-countdown={waiting ? remaining : undefined}
    >
      {children}
      {waiting && (
        <span aria-hidden className="tabular-nums">
          ({remaining})
        </span>
      )}
    </AlertDialogAction>
  );
}

/** The wait a locked chat imposes before an override, or none when unlocked. */
export function lockOverrideDelay(
  info: Pick<ChatInfo, "learning_mode_locked">,
) {
  return info.learning_mode_locked ? LOCK_OVERRIDE_DELAY_SECONDS : 0;
}
