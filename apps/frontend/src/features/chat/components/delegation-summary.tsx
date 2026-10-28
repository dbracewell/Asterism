"use client";

import Constellation from "@/components/logo";
import MarkdownViewer from "@/components/markdown-viewer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AgentConstellation } from "@/features/chat/components/agent-constellation";
import {
  AgentTimeline,
  chevronClass,
  triggerClass,
} from "@/features/chat/components/agent-timeline";
import { formatDuration } from "@/features/chat/lib/agent-timeline";
import {
  activitiesFromRecords,
  delegationSteps,
  delegationSummary,
  recordDurationMs,
} from "@/features/chat/lib/delegations";
import type { DelegationRecord } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import React from "react";

const statusLabel: Record<DelegationRecord["status"], string> = {
  running: "Cancelled",
  completed: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

/**
 * A finished delegation run folded into one line, e.g. "3 agents · 12.0 s ·
 * 7 tools". Expanding shows the constellation, then each agent's timeline and
 * output. Always starts collapsed, both after a live run and in history.
 * Names, tool payloads and output are untrusted and render as text/Markdown.
 */
export const DelegationSummary = ({
  records,
  mainModel,
}: {
  records: DelegationRecord[];
  mainModel?: string | null;
}) => {
  const activities = React.useMemo(
    () => activitiesFromRecords(records),
    [records],
  );
  if (records.length === 0) return null;

  return (
    <Collapsible
      data-slot="delegation-summary"
      className="group/delegation text-muted-foreground text-sm"
    >
      <CollapsibleTrigger
        className={cn(triggerClass, "max-w-full font-medium")}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            chevronClass,
            "group-data-[state=open]/delegation:rotate-90",
          )}
        />
        <Constellation
          size={16}
          fill="currentColor"
          strokeWidth={14}
          className="shrink-0"
        />
        <span className="truncate">{delegationSummary(records)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex min-w-0 flex-col gap-3">
        <AgentConstellation activities={activities} mainModel={mainModel} />
        <ol
          aria-label="Delegated agents"
          className="flex min-w-0 flex-col gap-2"
        >
          {records.map((record) => (
            <li
              key={record.execution_id}
              data-testid={`delegation-${record.execution_id}`}
              className={cn(
                "bg-muted/60 border-border rounded-surface text-foreground min-w-0 border px-3 py-2 [overflow-wrap:anywhere]",
                record.status === "error" && "border-destructive/60",
              )}
            >
              <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">{record.name}</span>
                {record.model_name && (
                  <span className="text-muted-foreground text-xs">
                    {record.model_name}
                  </span>
                )}
                {record.depth > 1 && (
                  <span className="text-muted-foreground text-xs">
                    Depth {record.depth}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto text-xs">
                  {statusLabel[record.status]} ·{" "}
                  {formatDuration(recordDurationMs(record))}
                </span>
              </header>
              <AgentTimeline className="mt-1" steps={delegationSteps(record)} />
              {record.output && (
                <MarkdownViewer
                  content={record.output}
                  className="mt-2 text-sm"
                />
              )}
              {record.error && (
                <p className="text-destructive mt-2 whitespace-pre-wrap">
                  {record.error}
                </p>
              )}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
};
