"use client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { HelpTopic } from "@/features/help/components/help-topic";
import type { Chat } from "@/lib/client";

/** The composer's context meter, with "Compact now" (ADR-0060). */
export const ContextUsageProgress = ({
  usage,
  contextWindow,
  onCompact,
  canCompact = false,
  compacting = false,
}: {
  usage: Chat["context_usage"];
  contextWindow: number | null;
  /** Summarize earlier turns now (ADR-0060); omitted where unsupported. */
  onCompact?: () => void;
  canCompact?: boolean;
  compacting?: boolean;
}) => {
  if (!usage || !contextWindow) return null;

  const percent = Math.min(
    100,
    Math.round((usage.total_tokens / contextWindow) * 100),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 px-1"
          aria-label={`Context usage: about ${percent}% of the model's context window`}
        >
          <Progress
            value={percent}
            max={100}
            className="bg-background h-2.5 w-10"
          />
          <span className="text-muted-foreground text-xs tabular-nums select-none">
            {percent}%
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <p className="font-medium">Context usage</p>
            <HelpTopic id="concept.context-compaction" side="top" />
          </div>
          <p className="text-muted-foreground text-xs">
            The next request is estimated at about{" "}
            {usage.total_tokens.toLocaleString()} of{" "}
            {contextWindow.toLocaleString()} tokens ({percent}%). Near the
            limit, earlier turns are summarized automatically so the chat keeps
            working.
          </p>
        </div>
        {onCompact && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canCompact || compacting}
            onClick={onCompact}
          >
            {compacting ? "Compacting…" : "Compact now"}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
};
