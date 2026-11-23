"use client";

import { useQuery } from "@tanstack/react-query";
import { FormSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Progress } from "@/components/ui/progress";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import {
  budgetPercent,
  formatResetTime,
  formatTokens,
} from "@/features/usage/format";
import { client } from "@/lib/api";
import type { MyUsage, UsageWindow } from "@/lib/client";
import { usageGetMineOptions } from "@/lib/client/@tanstack/react-query.gen";

/** Your Asterism → Usage: tokens today and this month, against your group's budget (US-86.3). */
export function YourUsageSection() {
  const query = useQuery({
    ...usageGetMineOptions({ client }),
    refetchOnWindowFocus: true,
  });
  return (
    <SettingsSection
      title="Usage"
      description="Tokens are the pieces of text models read and write. Every model call counts: chats, sub-agents, study tools, checks, titles and image captions."
    >
      {query.isPending && <FormSkeleton label="Loading your usage…" />}
      {query.error && (
        <QueryError
          error={query.error}
          message="Could not load your usage."
          retry={query.refetch}
          isRetrying={query.isFetching}
        />
      )}
      {query.data && <UsageSummary usage={query.data} />}
    </SettingsSection>
  );
}

function UsageSummary({ usage }: { usage: MyUsage }) {
  const images = usage.month_by_model.reduce(
    (total, model) => total + model.images,
    0,
  );
  return (
    <div className="grid gap-4 text-sm">
      {usage.exempt && (
        <p className="text-muted-foreground">Admins have no usage budget.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <BudgetMeter
          label="Today"
          window={usage.day}
          timeZone={usage.timezone}
        />
        <BudgetMeter
          label="This month"
          window={usage.month}
          timeZone={usage.timezone}
        />
      </div>
      {images > 0 && (
        <p className="text-muted-foreground">
          {images === 1 ? "1 image" : `${images} images`} made this month.
        </p>
      )}
    </div>
  );
}

function BudgetMeter({
  label,
  window,
  timeZone,
}: {
  label: string;
  window: UsageWindow;
  timeZone: string;
}) {
  const percent = budgetPercent(window.used_tokens, window.budget_tokens);
  const used = formatTokens(window.used_tokens);
  const reset = formatResetTime(window.resets_at, timeZone);
  return (
    <section
      aria-label={label}
      className="rounded-surface grid gap-2 border p-3"
    >
      <h3 className="font-medium">{label}</h3>
      {window.budget_tokens == null ? (
        <p>
          {used} used. <span className="text-muted-foreground">No budget.</span>
        </p>
      ) : (
        <>
          <p>
            {used} of {formatTokens(window.budget_tokens)}
          </p>
          <Progress
            value={percent ?? 0}
            aria-label={`${label}: ${percent}% of your budget used`}
          />
          <p
            className={
              window.remaining_tokens === 0
                ? "text-destructive"
                : "text-muted-foreground"
            }
          >
            {window.remaining_tokens === 0
              ? `Used up. New work can start again ${reset}.`
              : `${formatTokens(window.remaining_tokens ?? 0)} left · resets ${reset}`}
          </p>
        </>
      )}
    </section>
  );
}
