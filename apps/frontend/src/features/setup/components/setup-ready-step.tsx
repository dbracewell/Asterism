"use client";

import { Button } from "@/components/ui/button";
import { actionClassName } from "./provider-setup-shared";

export function ReadyStep({
  onStart,
  onContinueSetup,
}: {
  onStart: () => void;
  onContinueSetup: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 text-center">
      <p role="status" className="text-body font-medium text-balance">
        You&apos;re ready to start your exploration.
      </p>
      <p className="text-muted-foreground text-sm text-balance">
        Asterism can be used now. The rest of setup walks through each
        administrator setting, such as groups, tools and image captioning,
        explaining what it does and its default. You can skip any step and
        return later from Admin Settings → Setup.
      </p>
      {/* The form that had focus is gone; continue from the next action. */}
      <Button autoFocus className={actionClassName} onClick={onContinueSetup}>
        Continue setup
      </Button>
      <Button variant="outline" className={actionClassName} onClick={onStart}>
        Start chatting
      </Button>
    </div>
  );
}
