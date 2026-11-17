"use client";

import { Button } from "@/components/ui/button";
import { actionClassName } from "./provider-setup-shared";

export function ReadyStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 text-center">
      <p role="status" className="text-body font-medium text-balance">
        You&apos;re ready to start your exploration.
      </p>
      {/* The form that had focus is gone; continue from the next action. */}
      <Button autoFocus className={actionClassName} onClick={onStart}>
        Start chatting
      </Button>
    </div>
  );
}
