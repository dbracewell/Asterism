import { LoaderCircleIcon } from "lucide-react";
import type { ReactNode } from "react";

/** An inline, announced progress line for long study requests. */
export function PendingStatus({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm">
      <LoaderCircleIcon
        aria-hidden
        className="text-muted-foreground size-4 shrink-0 animate-spin"
      />
      <span>{children}</span>
    </div>
  );
}
