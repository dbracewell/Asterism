import { Progress } from "@/components/ui/progress";
import type { ToolProgressEvent } from "../schemas";
import { imageProgress } from "../lib/image-generation";

/** What an image request is doing right now, with a bar once steps are known. */
export function ImageProgressStatus({
  progress,
}: {
  progress: ToolProgressEvent | null;
}) {
  const state = imageProgress(progress);
  if (!state) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted-foreground mb-5 flex max-w-sm flex-col gap-1.5 pl-10 text-sm"
    >
      <span>{state.label}</span>
      {state.percent != null && (
        <Progress value={state.percent} aria-label="Image progress" />
      )}
    </div>
  );
}
