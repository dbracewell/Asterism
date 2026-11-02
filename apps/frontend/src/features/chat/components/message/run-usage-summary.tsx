"use client";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AgentUsage,
  costLabel,
  formatCost,
  formatTokens,
  runUsage,
  usageSummary,
} from "@/features/chat/lib/run-usage";
import type { Message } from "@/lib/client";
import { cn } from "@/lib/utils";
import React from "react";

const tokens = (row: { inputTokens: number; outputTokens: number }) =>
  `${formatTokens(row.inputTokens)} in · ${formatTokens(row.outputTokens)} out`;

function AgentRow({ agent }: { agent: AgentUsage }) {
  const cost = costLabel(agent);
  return (
    <li
      data-testid={`usage-agent-${agent.id}`}
      className="flex min-w-0 flex-col gap-1"
      style={{
        paddingInlineStart: `${Math.max(agent.depth - 1, 0) * 0.75}rem`,
      }}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {/* Names and model ids are untrusted text; React escapes them. */}
        <span className="text-foreground font-medium [overflow-wrap:anywhere]">
          {agent.name}
        </span>
        {agent.model && (
          <span className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
            {agent.model}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums">
          {tokens(agent)}
          {cost ? ` · ${cost}` : ""}
        </span>
      </div>
      {agent.steps.length > 1 && (
        <ol className="text-muted-foreground flex flex-col gap-0.5 ps-3 text-xs tabular-nums">
          {agent.steps.map((step, index) => (
            <li key={index} className="flex gap-2">
              <span>Step {index + 1}</span>
              <span className="ml-auto">
                {tokens(step)}
                {step.cost != null ? ` · ~${formatCost(step.cost)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * Total tokens and estimated cost for one turn; opening it breaks the totals
 * down per agent and per model call. Costs use the prices recorded when the
 * run executed. Models without prices show tokens only; plan-backed runs show
 * "ChatGPT plan" instead of dollars.
 */
export function RunUsageSummary({
  steps,
  className,
}: {
  steps: Message[];
  className?: string;
}) {
  const usage = React.useMemo(() => runUsage(steps), [steps]);
  const agents = usage.agents.filter((agent) => agent.steps.length > 0);
  if (!usage.inputTokens && !usage.outputTokens) return null;
  const summary = usageSummary(usage);

  return (
    <Popover>
      <PopoverTrigger
        data-slot="run-usage"
        aria-label={`Run usage: ${summary}. Show breakdown`}
        className={cn(
          "rounded-control hover:text-foreground focus-visible:ring-ring/50 tabular-nums outline-none focus-visible:ring-3",
          className,
        )}
      >
        {summary}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Run usage</PopoverTitle>
          <p className="text-muted-foreground">
            {usage.allPlan
              ? "Runs on a ChatGPT plan count toward plan usage, not dollars."
              : "Estimated from the prices recorded when this run executed."}
            {usage.partialCost &&
              " Models without prices show tokens only and are not included in the cost."}
          </p>
        </PopoverHeader>
        <ul
          aria-label="Usage by agent"
          className="mt-3 flex flex-col gap-2 text-sm"
        >
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </ul>
        <p className="border-border mt-3 flex border-t pt-2 text-sm font-medium tabular-nums">
          <span>Total</span>
          <span className="ml-auto">{summary}</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}
