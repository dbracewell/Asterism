"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlanUsageIndicator } from "@/features/chatgpt/components/plan-usage";
import { HelpTopic } from "@/features/help/components/help-topic";
import { client } from "@/lib/api";
import type { Chat } from "@/lib/client";
import {
  chatModelsListOptions,
  mainAgentGeneralSubAgentsGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, BotIcon, BotOffIcon } from "lucide-react";
import Link from "next/link";
import { generalDelegationState } from "../lib/general-delegation";

/**
 * The composer's status indicator (US-73.2): a ring for context usage and a
 * dot for the connection. Its popover holds "Compact now" (ADR-0060), the
 * General chat sub-agents (ADR-0059) and ChatGPT plan usage. Renders nothing
 * when there is nothing to report.
 */
export function ComposerStatus({
  usage,
  contextWindow,
  onCompact,
  canCompact = false,
  compacting = false,
  connection,
  modelId,
  general = false,
}: {
  usage?: Chat["context_usage"];
  contextWindow?: number | null;
  /** Summarize earlier turns now; omitted where unsupported. */
  onCompact?: () => void;
  canCompact?: boolean;
  compacting?: boolean;
  /** The chat socket's state; omitted before a chat exists. */
  connection?: string;
  /** The chat model, for the sub-agent and plan rows. */
  modelId?: string | null;
  /** A General chat shows whether its sub-agents can be used. */
  general?: boolean;
}) {
  const models = useQuery({ ...chatModelsListOptions({ client }) });
  const model = models.data?.find((item) => item.id === modelId);
  const subAgents = useQuery({
    ...mainAgentGeneralSubAgentsGetOptions({ client }),
    staleTime: 0,
    retry: false,
    enabled: general,
  });
  const delegation = general
    ? generalDelegationState(subAgents.data, model)
    : ({ kind: "none" } as const);
  const plan = model?.provider_type === "chatgpt" && model.available;
  const percent =
    usage && contextWindow
      ? Math.min(100, Math.round((usage.total_tokens / contextWindow) * 100))
      : null;
  const connected = connection === "Connected";
  if (percent === null && !connection && delegation.kind === "none" && !plan)
    return null;

  const delegationLabel =
    delegation.kind === "available"
      ? `Sub-agents available: ${delegation.names.join(", ")}`
      : delegation.kind === "blocked"
        ? `Sub-agents unavailable. ${delegation.reason}`
        : "";
  const DelegationIcon = delegation.kind === "available" ? BotIcon : BotOffIcon;

  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="rounded-control relative"
            aria-label={
              percent === null
                ? "Chat status"
                : `Context usage: about ${percent}% of the model's context window`
            }
          >
            {percent === null ? (
              <ActivityIcon aria-hidden="true" />
            ) : (
              <UsageRing percent={percent} />
            )}
            {connection && (
              <span
                aria-hidden="true"
                className={cn(
                  "rounded-dot ring-background absolute right-1.5 bottom-1.5 size-2 ring-2",
                  connected ? "bg-primary" : "bg-destructive",
                )}
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-72 text-sm">
          <PopoverHeader>
            <PopoverTitle>Chat status</PopoverTitle>
          </PopoverHeader>
          {percent !== null && usage && contextWindow && (
            <section
              aria-label="Context usage"
              className="flex flex-col items-start gap-2"
            >
              <div className="flex items-center gap-1">
                <p className="font-medium">Context usage</p>
                <HelpTopic id="concept.context-compaction" side="top" />
              </div>
              <p className="text-muted-foreground text-xs">
                The next request is estimated at about{" "}
                {usage.total_tokens.toLocaleString()} of{" "}
                {contextWindow.toLocaleString()} tokens ({percent}%). Near the
                limit, earlier turns are summarized automatically so the chat
                keeps working.
              </p>
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
            </section>
          )}
          {connection && (
            <p className="flex items-center justify-between gap-2">
              <span className="font-medium">Connection</span>
              <span className="text-muted-foreground text-xs">
                {connection}
              </span>
            </p>
          )}
          {delegation.kind !== "none" && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={cn(
                "h-auto justify-start py-1.5 text-left whitespace-normal",
                delegation.kind === "blocked" && "text-muted-foreground",
              )}
            >
              <Link href="/settings?t=user&setting=agents">
                <DelegationIcon aria-hidden="true" />
                <span>
                  {delegationLabel}{" "}
                  <span className="text-muted-foreground">
                    Manage them in agent settings.
                  </span>
                </span>
              </Link>
            </Button>
          )}
          {plan && <PlanUsageIndicator className="px-0" />}
        </PopoverContent>
      </Popover>
      {connection && (
        <span
          role="status"
          className={connected ? "sr-only" : "text-muted-foreground text-xs"}
        >
          {connection}
        </span>
      )}
    </div>
  );
}

/** A small ring filled to `percent`. */
function UsageRing({ percent }: { percent: number }) {
  const circumference = 2 * Math.PI * 7;
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="size-5 -rotate-90">
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        strokeWidth="2.5"
        className="stroke-border"
      />
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
        className="stroke-primary"
      />
    </svg>
  );
}
