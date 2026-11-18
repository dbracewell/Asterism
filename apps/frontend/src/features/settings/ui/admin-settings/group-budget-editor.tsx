"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client } from "@/lib/api";
import type { Group } from "@/lib/client";
import { groupBudgetUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";

const MAX_DAILY = 10_000_000_000;
const MAX_MONTHLY = 1_000_000_000_000;

function parseBudget(value: string, max: number): number | null | "invalid" {
  const trimmed = value.trim().replaceAll(",", "");
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const tokens = Number(trimmed);
  return tokens >= 1 && tokens <= max ? tokens : "invalid";
}

/** Daily and monthly token budgets for each member of a group (US-86.3). Empty means no budget. */
export function GroupBudgetEditor({ group }: { group: Group }) {
  const id = useId();
  const [daily, setDaily] = useState(
    group.daily_token_budget?.toString() ?? "",
  );
  const [monthly, setMonthly] = useState(
    group.monthly_token_budget?.toString() ?? "",
  );
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    ...groupBudgetUpdateMutation({ client }),
    onSuccess: () => setSaved(true),
  });
  const dailyTokens = parseBudget(daily, MAX_DAILY);
  const monthlyTokens = parseBudget(monthly, MAX_MONTHLY);
  const invalid = dailyTokens === "invalid" || monthlyTokens === "invalid";
  const change = (set: (value: string) => void) => (value: string) => {
    setSaved(false);
    set(value);
  };
  return (
    <form
      className="grid gap-3 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        save.mutate({
          path: { group_id: group.id },
          body: {
            daily_token_budget: dailyTokens,
            monthly_token_budget: monthlyTokens,
          },
        });
      }}
    >
      <div className="flex flex-wrap gap-4">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-daily`}>Tokens per member per day</Label>
          <Input
            id={`${id}-daily`}
            inputMode="numeric"
            className="w-48"
            placeholder="No budget"
            value={daily}
            onChange={(event) => change(setDaily)(event.target.value)}
            aria-invalid={dailyTokens === "invalid"}
            disabled={save.isPending}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-monthly`}>Tokens per member per month</Label>
          <Input
            id={`${id}-monthly`}
            inputMode="numeric"
            className="w-48"
            placeholder="No budget"
            value={monthly}
            onChange={(event) => change(setMonthly)(event.target.value)}
            aria-invalid={monthlyTokens === "invalid"}
            disabled={save.isPending}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Input and output tokens of every model call count. When a member has
        used their budget, new sends, regenerations, study tools and images are
        refused until it resets; replies already running finish. Days and months
        follow the timezone in Usage. Leave a field empty for no budget.
      </p>
      {invalid && (
        <p role="alert" className="text-destructive text-sm">
          Enter a whole number of tokens of at least 1, or leave it empty.
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(save.error, "Could not save the budget.")}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          Budget saved. It applies to {group.name} from their next request.
        </p>
      )}
      <Button
        type="submit"
        className="w-fit"
        disabled={invalid || save.isPending}
      >
        {save.isPending ? "Saving…" : `Save budget for ${group.name}`}
      </Button>
    </form>
  );
}
