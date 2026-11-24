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
import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { SETUP_STEPS, type SetupStep } from "../steps";
import { nextStep, stepGuideHref } from "../walkthrough";

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
        <Button
          variant="ghost"
          size="sm"
          aria-current={current ? undefined : "step"}
          className={cn(
            "h-auto w-full justify-start py-1.5 font-normal",
            !current && "bg-accent font-medium",
          )}
          onClick={() => go(null)}
        >
          Summary
        </Button>
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
              <GuideLink step={current} />
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
          <SetupSummary states={states} onOpen={go} />
        )}
      </div>
    </div>
  );
}

function GuideLink({ step }: { step: SetupStep }) {
  const href = stepGuideHref(step);
  if (!href) return null;
  const className =
    "text-primary w-fit text-sm underline-offset-4 hover:underline";
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      Read more in the guide: {step.title}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      Read more: {step.title}
      <ExternalLinkIcon aria-hidden className="ml-1 inline size-3.5" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Where setup stands: what is left, what was skipped and what was reviewed. */
function SetupSummary({
  states,
  onOpen,
}: {
  states: Record<string, SetupStepState>;
  onOpen: (step: SetupStep) => void;
}) {
  const groups = [
    {
      id: "left",
      title: "Not reviewed",
      steps: SETUP_STEPS.filter((step) => !states[step.id]),
    },
    {
      id: "skipped",
      title: "Skipped",
      steps: SETUP_STEPS.filter((step) => states[step.id]?.state === "skipped"),
    },
    {
      id: "done",
      title: "Reviewed",
      steps: SETUP_STEPS.filter((step) => states[step.id]?.state === "done"),
    },
  ].filter((group) => group.steps.length);
  const finished = SETUP_STEPS.every((step) => states[step.id]);
  return (
    <section
      aria-labelledby="setup-summary"
      className="rounded-surface flex flex-col gap-4 border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="setup-summary" className="text-base font-semibold">
          {finished ? "Every step has been reviewed" : "Setup summary"}
        </h2>
        <p className="text-sm">
          {finished
            ? "Asterism is set up. Change any setting later in its own section of Admin Settings, or reopen a step here."
            : "Steps not reviewed or skipped keep their defaults. Open one to review it now, or come back to Admin Settings → Setup later."}
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <h3 id={`setup-summary-${group.id}`} className="text-sm font-medium">
            {group.title} ({group.steps.length})
          </h3>
          <ul
            aria-labelledby={`setup-summary-${group.id}`}
            className="flex flex-wrap gap-1"
          >
            {group.steps.map((step) => (
              <li key={step.id}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpen(step)}
                >
                  {step.title}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Button asChild className="w-fit">
        <Link href="/">Start chatting</Link>
      </Button>
    </section>
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
