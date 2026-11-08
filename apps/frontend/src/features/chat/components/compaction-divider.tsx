"use client";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChatCompactionView } from "@/lib/client";
import { ChevronDownIcon } from "lucide-react";
import React from "react";

/**
 * Marks where earlier messages were replaced by a summary (ADR-0060). The
 * messages above stay visible; only the model reads the summary instead.
 * The summary is untrusted model output, so it renders as plain text.
 */
export const CompactionDivider = ({
  compaction,
}: {
  compaction: ChatCompactionView;
}) => {
  const [open, setOpen] = React.useState(false);
  const count = compaction.replaced_messages;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="compaction-divider"
      className="my-4"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="bg-border h-px flex-1" />
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          >
            Conversation compacted: {count} earlier{" "}
            {count === 1 ? "message" : "messages"} summarized
            <ChevronDownIcon
              aria-hidden="true"
              className={open ? "rotate-180" : undefined}
            />
          </Button>
        </CollapsibleTrigger>
        <span aria-hidden="true" className="bg-border h-px flex-1" />
      </div>
      <CollapsibleContent className="bg-muted/50 rounded-surface mx-auto mt-2 max-w-3xl p-3 text-sm">
        <p className="text-muted-foreground mb-2 text-xs">
          Written by {compaction.model_name}{" "}
          {compaction.trigger === "manual"
            ? "when you chose Compact now"
            : "automatically, as the chat neared the model's context limit"}
          . The messages above are kept, but the model now reads this summary
          instead of them.
        </p>
        <p className="whitespace-pre-wrap" data-slot="compaction-summary">
          {compaction.summary}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
};
