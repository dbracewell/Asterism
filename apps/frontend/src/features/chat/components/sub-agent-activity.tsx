"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { AgentConstellation } from "@/features/chat/components/agent-constellation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useDelegationAnnouncements } from "@/features/chat/hooks/use-delegation-announcements";
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
  if (activity.status === "cancelled") return "Cancelled";
  return "Working";
};

export const SubAgentActivityPanel = ({
  activities,
  mainModel,
}: {
  activities: SubAgentActivity[];
  /** Model the main agent runs with in this chat, when known. */
  mainModel?: string | null;
}) => {
  const announcement = useDelegationAnnouncements(activities);
  // The live region stays mounted so the first agent's start is spoken.
  const announcer = (
    <p aria-live="polite" data-slot="delegation-announcer" className="sr-only">
      {announcement}
    </p>
  );
  if (activities.length === 0) return announcer;

  return (
    <>
      {announcer}
      <section
        aria-label="Sub-agent activity"
        className="mb-4 flex w-full min-w-0 flex-col gap-2"
      >
        <AgentConstellation activities={activities} mainModel={mainModel} />
        {activities.map((activity) => (
          <article
            key={activity.executionId}
            data-testid={`sub-agent-${activity.executionId}`}
            className={cn(
              "bg-muted/60 border-border rounded-surface min-w-0 border px-3 py-2 text-sm [overflow-wrap:anywhere]",
              activity.status === "error" && "border-destructive/60",
            )}
          >
            <header className="flex flex-wrap items-center gap-2 font-medium">
              <BotIcon className="size-4" aria-hidden="true" />
              <span>{activity.name}</span>
              {activity.modelName && (
                <span className="text-muted-foreground text-xs font-normal">
                  {activity.modelName}
                </span>
              )}
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
                  <CircleCheckIcon className="text-primary size-3" />
                )}
                {activity.status === "error" && (
                  <CircleXIcon className="text-destructive size-3" />
                )}
                <span>{statusLabel(activity)}</span>
              </span>
            </header>

            {activity.thinking && (
              <Collapsible className="text-muted-foreground mt-2">
                <CollapsibleTrigger className="hover:text-foreground cursor-pointer text-xs font-medium">
                  Thinking
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {activity.thinking}
                  </p>
                </CollapsibleContent>
              </Collapsible>
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
    </>
  );
};
