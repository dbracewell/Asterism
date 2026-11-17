"use client";

import { Button } from "@/components/ui/button";
import { ArrowDownIcon } from "lucide-react";

/** The floating pill back to the conversation's end; pulses while generating. */
export function JumpToLatest({
  generating,
  onClick,
}: {
  generating: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      data-slot="jump-to-latest"
      className="rounded-dot shadow-overlay bg-background absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2"
      aria-label="Jump to latest message"
      onClick={onClick}
    >
      {generating ? (
        <span
          aria-hidden="true"
          className="bg-primary rounded-dot size-1.5 animate-pulse motion-reduce:animate-none"
        />
      ) : (
        <ArrowDownIcon />
      )}
      Jump to latest
    </Button>
  );
}
