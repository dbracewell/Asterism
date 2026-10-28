"use client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { StreamingMessage } from "@/features/chat/types";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { BrainIcon } from "lucide-react";
import React from "react";

export const MessageThinking = ({
  message,
  defaultOpen,
}: {
  message: StreamingMessage;
  defaultOpen: boolean;
}) => {
  const [open, setOpen] = React.useState(defaultOpen);
  const thinkingRef = React.useRef<HTMLParagraphElement>(null);
  React.useEffect(() => {
    if (defaultOpen && thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [message.thinking, defaultOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "text-muted-foreground rounded-surface p-2 text-sm",
        !message.thinking && "hidden",
      )}
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between text-left font-medium">
        <span>
          <BrainIcon className="inline-block size-5" /> Thinking{" "}
          {message.tool_calls && (
            <>({formatPlural(message.tool_calls.length, "tool call")})</>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <p
          ref={thinkingRef}
          className="max-h-50 overflow-y-auto whitespace-pre-wrap select-text"
          style={{ overflowAnchor: "auto" }}
        >
          {message.thinking ?? ""}
        </p>
        {message.tool_calls && message.tool_calls.length > 0 && (
          <h4 className="mt-0.5 font-bold">Tools</h4>
        )}
        {message.tool_calls?.map((tc) => (
          <div key={tc.id}>
            • {tc.function.name}{" "}
            {tc.function.arguments !== "{}" && tc.function.arguments}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};
