"use client";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { client } from "@/lib/api";
import {
  chatModelsListOptions,
  mainAgentGeneralSubAgentsGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, BotOffIcon } from "lucide-react";
import Link from "next/link";
import { generalDelegationState } from "../lib/general-delegation";

/**
 * Composer indicator for a General chat (ADR-0059): shows whether the main
 * agent can hand work to the user's General chat sub-agents with this model.
 * Shows nothing when none are chosen or the set can't be read.
 */
export function GeneralDelegationStatus({
  modelId,
}: {
  modelId?: string | null;
}) {
  const set = useQuery({
    ...mainAgentGeneralSubAgentsGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const models = useQuery({ ...chatModelsListOptions({ client }) });
  const state = generalDelegationState(
    set.data,
    models.data?.find((model) => model.id === modelId),
  );
  if (state.kind === "none") return null;
  const label =
    state.kind === "available"
      ? `Sub-agents available: ${state.names.join(", ")}`
      : `Sub-agents unavailable. ${state.reason}`;
  const Icon = state.kind === "available" ? BotIcon : BotOffIcon;
  return (
    <Hint hint={`${label} Manage them in agent settings.`}>
      <Button
        asChild
        variant="ghost"
        size="icon-lg"
        className={cn(
          "rounded-control",
          state.kind === "blocked" && "text-muted-foreground",
        )}
      >
        <Link href="/settings?t=user&setting=agents" aria-label={label}>
          <Icon aria-hidden />
        </Link>
      </Button>
    </Hint>
  );
}
