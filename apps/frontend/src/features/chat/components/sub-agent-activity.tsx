"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { SubAgentActivity } from "@/features/chat/types";
import { cn } from "@/lib/utils";
import {
  BotIcon,
  CircleCheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
  WrenchIcon,
} from "lucide-react";

const statusLabel = (activity: SubAgentActivity) => {
  if (activity.status === "completed") return "Completed";
  if (activity.status === "error") return "Failed";
  return "Working";
};

export const SubAgentActivityPanel = ({
  activities,
}: {
  activities: SubAgentActivity[];
}) => {
  if (activities.length === 0) return null;

  return (
    <section
      aria-label="Sub-agent activity"
      className="mb-4 flex w-full flex-col gap-2"
    >
      {activities.map((activity) => (
        <article
          key={activity.executionId}
          data-testid={`sub-agent-${activity.executionId}`}
          className={cn(
            "bg-muted/60 border-border overflow-auto rounded-xl border px-3 py-2 text-sm",
            activity.status === "error" && "border-destructive/60",
          )}
        >
          <header className="flex items-center gap-2 font-medium">
            <BotIcon className="size-4" aria-hidden="true" />
            <span>{activity.name}</span>
            {activity.depth > 1 && (
              <span className="text-muted-foreground text-xs">
                Depth {activity.depth}
              </span>
            )}
            <span className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
              {activity.status === "running" && (
                <LoaderCircleIcon className="size-3 animate-spin" />
              )}
              {activity.status === "completed" && (
                <CircleCheckIcon className="size-3 text-green-600" />
              )}
              {activity.status === "error" && (
                <CircleXIcon className="text-destructive size-3" />
              )}
              <span aria-live="polite">{statusLabel(activity)}</span>
            </span>
          </header>

          {activity.thinking && (
            <details className="text-muted-foreground mt-2">
              <summary>Thinking</summary>
              <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {activity.thinking}
              </p>
            </details>
          )}

          {activity.toolCalls.length > 0 && (
            <div className="mt-2" aria-label="Sub-agent tools">
              {activity.toolCalls.map((toolCall) => (
                <div
                  key={toolCall.id}
                  className="text-muted-foreground flex items-start gap-1"
                >
                  <WrenchIcon className="mt-0.5 size-3 shrink-0" />
                  <span>
                    {toolCall.function.name}
                    {toolCall.function.arguments !== "{}" &&
                      ` ${toolCall.function.arguments}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {activity.content && (
            <MarkdownViewer
              content={activity.content}
              className="mt-2 text-sm"
            />
          )}
          {activity.error && (
            <p
              role="alert"
              className="text-destructive mt-2 whitespace-pre-wrap"
            >
              {activity.error}
            </p>
          )}
        </article>
      ))}
    </section>
  );
};
