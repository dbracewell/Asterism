"use client";

import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useUser } from "@/features/auth/components/user-context";
import { useReadWriteSearchParams } from "@/hooks/use-read-write-search-params";
import { client } from "@/lib/api";
import type { SetupStepState } from "@/lib/client";
import {
  setupProgressGetOptions,
  setupProgressGetQueryKey,
  setupStepUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn, errorMessage } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { nextStep, SETUP_STEPS, type SetupStep } from "../walkthrough";

const STATE_LABEL = { done: "Done", skipped: "Skipped" } as const;

/**
 * Admin Settings → Setup (US-101.2): every setup step in order, each showing
 * what it does and its default above that section's own pane, with Skip and
 * Next. Progress is stored on the server and shared by every administrator,
 * so setup resumes at the first step nobody reviewed.
 */
export function SetupWalkthrough({
  panes,
}: {
  /** Each step's Admin Settings pane, by step id. */
  panes: Record<string, ReactNode>;
}) {
  const user = useUser();
  if (user.role !== "admin")
    return (
      <p role="alert">Administrator access is required to set up Asterism.</p>
    );
  return <Walkthrough panes={panes} />;
}

function Walkthrough({ panes }: { panes: Record<string, ReactNode> }) {
  const { getSearchParam, setSearchParams } = useReadWriteSearchParams();
  const progress = useQuery({
    ...setupProgressGetOptions({ client }),
    staleTime: 0,
  });
  const record = useMutation({
    ...setupStepUpdateMutation({ client }),
    // Setup progress changes no other setting.
    meta: { invalidates: [setupProgressGetQueryKey({ client })] },
  });

  if (!progress.data)
    return progress.isError ? (
      <QueryError
        error={progress.error}
        message="Setup progress could not be loaded."
        retry={() => progress.refetch()}
        isRetrying={progress.isFetching}
      />
    ) : (
      <Spinner />
    );

  const states = progress.data.steps ?? {};
  const param = getSearchParam("step");
  const requested = SETUP_STEPS.find((step) => step.id === param);
  // "summary" shows the end even while some steps are not reviewed.
  const current = param === "summary" ? null : (requested ?? nextStep(states));
  const reviewed = SETUP_STEPS.filter((step) => states[step.id]).length;
  const go = (step: SetupStep | null) =>
    setSearchParams({ step: step?.id ?? "summary" });

  const finish = (step: SetupStep, state: "done" | "skipped") =>
    record.mutate(
      { path: { step_id: step.id }, body: { state } },
      {
        onSuccess: (data) => {
          const index = SETUP_STEPS.indexOf(step);
          // Continue to the next step nobody reviewed after this one.
          const later = SETUP_STEPS.slice(index + 1).find(
            (candidate) => !data.steps?.[candidate.id],
          );
          go(later ?? nextStep(data.steps ?? {}));
        },
      },
    );

  return (
    <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
      <nav
        aria-label="Setup steps"
        className="flex shrink-0 flex-col gap-2 lg:sticky lg:top-0 lg:w-56"
      >
        <p className="text-muted-foreground text-sm" role="status">
          {reviewed} of {SETUP_STEPS.length} steps reviewed
        </p>
        <ol className="flex flex-col gap-0.5">
          {SETUP_STEPS.map((step, index) => (
            <li key={step.id}>
              <Button
                variant="ghost"
                size="sm"
                aria-current={step.id === current?.id ? "step" : undefined}
                className={cn(
                  "h-auto w-full justify-between gap-2 py-1.5 text-left font-normal whitespace-normal",
                  step.id === current?.id && "bg-accent font-medium",
                )}
                onClick={() => go(step)}
              >
                <span>
                  {index + 1}. {step.title}
                </span>
                <StepBadge state={states[step.id]} />
              </Button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {current ? (
          <>
            <section
              aria-labelledby="setup-step-title"
              className="bg-muted/40 rounded-surface flex flex-col gap-3 border p-4"
            >
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs">
                  Step {SETUP_STEPS.indexOf(current) + 1} of{" "}
                  {SETUP_STEPS.length}
                </p>
                <h2 id="setup-step-title" className="text-base font-semibold">
                  {current.title}
                </h2>
              </div>
              <p className="text-sm">{current.explanation}</p>
              {current.whenOff && (
                <p className="text-sm font-medium">{current.whenOff}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={record.isPending}
                  onClick={() => finish(current, "done")}
                >
                  {record.isPending ? "Saving…" : "Next"}
                </Button>
                <Button
                  variant="outline"
                  disabled={record.isPending}
                  onClick={() => finish(current, "skipped")}
                >
                  Skip for now
                </Button>
                <StepBadge state={states[current.id]} />
              </div>
              <p className="text-muted-foreground text-xs">
                Save any changes below before choosing Next.
              </p>
              {record.isError && (
                <p role="alert" className="text-destructive text-sm">
                  {errorMessage(record.error, "The step could not be saved.")}
                </p>
              )}
            </section>
            <div className="min-w-0">{panes[current.id]}</div>
          </>
        ) : (
          <section
            aria-labelledby="setup-finished"
            className="rounded-surface flex flex-col gap-2 border p-4"
          >
            <h2 id="setup-finished" className="text-base font-semibold">
              {reviewed === SETUP_STEPS.length
                ? "Every step has been reviewed"
                : "Setup summary"}
            </h2>
            <p className="text-sm">
              You can return to any step from the list, or change a setting in
              its own section of Admin Settings at any time.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function StepBadge({ state }: { state?: SetupStepState }) {
  if (!state) return null;
  return (
    <Badge
      variant={state.state === "done" ? "secondary" : "outline"}
      className="shrink-0 px-1.5 py-0 text-[10px] font-normal"
    >
      {state.state === "done" && <CheckIcon aria-hidden />}
      {STATE_LABEL[state.state]}
    </Badge>
  );
}
