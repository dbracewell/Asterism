"use client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUser } from "@/features/auth/components/user-context";
import { StreamingMessage } from "@/features/chat/types";
import { useNow } from "@/hooks/use-now";
import { formatFullTimestamp, formatRelativeTime } from "@/lib/relative-time";
import React from "react";

export function tokensPerSecond(message: StreamingMessage): string | null {
  const tokens = message.output_tokens ?? 0;
  const ms = message.generation_duration_ms ?? 0;
  if (tokens <= 0 || ms <= 0) return null;
  return `${(tokens / (ms / 1000)).toFixed(1)} tok/s`;
}

/**
 * Stopped state, relative time and generation speed. The time is focusable
 * and shows the full timestamp in the user's time zone; on touch, a tap opens
 * it because tooltips have no hover there.
 */
export const MessageMeta = ({ message }: { message: StreamingMessage }) => {
  const { timezone } = useUser();
  const now = useNow();
  const [open, setOpen] = React.useState(false);
  const touchRef = React.useRef(false);
  const created = new Date(message.created_at * 1000);
  const speed = message.role === "user" ? null : tokensPerSecond(message);

  return (
    <span data-slot="message-meta">
      {message.status === "cancelled" && "Stopped · "}
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <time
            dateTime={created.toISOString()}
            tabIndex={0}
            className="rounded-control focus-visible:ring-ring/50 outline-none focus-visible:ring-3"
            onPointerDown={(event) => {
              touchRef.current = event.pointerType !== "mouse";
              if (touchRef.current) event.preventDefault();
            }}
            onClick={(event) => {
              if (!touchRef.current) return;
              event.preventDefault();
              setOpen(true);
            }}
          >
            {now === null
              ? null
              : formatRelativeTime(created, new Date(now), timezone)}
          </time>
        </TooltipTrigger>
        <TooltipContent side="top">
          {formatFullTimestamp(created, timezone)}
        </TooltipContent>
      </Tooltip>
      {speed && ` · ${speed}`}
    </span>
  );
};
