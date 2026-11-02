"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDuration } from "@/features/chat/lib/agent-timeline";
import { PendingStatus } from "@/features/study/components/pending-status";
import {
  StudyModelField,
  useStudyModel,
} from "@/features/study/components/source-fields";
import { studyErrorDetail } from "@/features/study/lib/error-detail";
import { client } from "@/lib/api";
import type { DisagreementSource, DisagreementSummary } from "@/lib/client";
import {
  chatComparisonDisagreementsFindMutation,
  chatDelegationDisagreementsFindMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatPlural } from "@/lib/formatters";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRightIcon, SplitIcon } from "lucide-react";
import { useState } from "react";

/** What a disagreement pass compares: a comparison's columns or a step's agents. */
export type DisagreementTarget =
  | { kind: "comparison"; chatId: string; comparisonId: string }
  | { kind: "delegations"; chatId: string; messageId: string };

const NOUN = { comparison: "answer", delegations: "agent result" } as const;

/**
 * Starts a bounded disagreement pass (US-55.3). One model call reads the
 * answers and lists where they conflict; the result replaces the previous one.
 */
export function FindDisagreements({
  target,
  sources,
  preferredModelId,
  again,
  disabled,
}: {
  target: DisagreementTarget;
  sources: number;
  preferredModelId?: string | null;
  again: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={disabled}
        >
          <SplitIcon data-icon="inline-start" aria-hidden />
          {again ? "Find disagreements again" : "Find disagreements"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {/* Mounted only while open, so models load on demand. */}
        <FindForm
          target={target}
          sources={sources}
          preferredModelId={preferredModelId}
          again={again}
          onBusyChange={setBusy}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function FindForm({
  target,
  sources,
  preferredModelId,
  again,
  onBusyChange,
  onDone,
}: {
  target: DisagreementTarget;
  sources: number;
  preferredModelId?: string | null;
  again: boolean;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}) {
  const choice = useStudyModel(preferredModelId);
  const handlers = {
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: onDone,
  };
  const columns = useMutation({
    ...chatComparisonDisagreementsFindMutation({ client }),
    ...handlers,
  });
  const agents = useMutation({
    ...chatDelegationDisagreementsFindMutation({ client }),
    ...handlers,
  });
  const find = target.kind === "comparison" ? columns : agents;
  const noun = NOUN[target.kind];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const model_id = choice.model;
        if (!model_id) return;
        if (target.kind === "comparison")
          columns.mutate({
            path: {
              chat_id: target.chatId,
              comparison_id: target.comparisonId,
            },
            body: { model_id },
          });
        else
          agents.mutate({
            path: { chat_id: target.chatId, message_id: target.messageId },
            body: { model_id },
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>Find disagreements</DialogTitle>
        <DialogDescription>
          Compares the {formatPlural(sources, noun)} and lists the points they
          cannot all be right about, with each one&apos;s position. It does not
          say which is correct, and it does not change them.
          {again && " This replaces the previous summary."}
        </DialogDescription>
      </DialogHeader>
      <StudyModelField
        id={`disagreements-model-${target.kind === "comparison" ? target.comparisonId : target.messageId}`}
        label="Model"
        description="The model that compares the answers. Its usage is shown with the result."
        disabled={find.isPending}
        choice={choice}
      />
      {find.isPending && (
        <PendingStatus>Comparing. This can take a minute.</PendingStatus>
      )}
      {find.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(find.error, "Could not compare. Try again.")}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={!choice.model || find.isPending}>
          Compare
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The stored disagreement summary: each conflicting point with every source's
 * position, and a control that moves focus to that column or agent. Topics and
 * positions are untrusted model text and render as text.
 */
export function DisagreementsPanel({
  summary,
  stale,
  onShowSource,
}: {
  summary: DisagreementSummary;
  /** An answer changed after the summary was made. */
  stale?: boolean;
  onShowSource: (source: DisagreementSource) => void;
}) {
  const sources = new Map(summary.sources.map((s) => [s.key, s]));
  const count = summary.disagreements.length;
  const { usage } = summary;
  const truncated = summary.sources.filter((s) => s.truncated);
  return (
    <section
      aria-label="Disagreements"
      data-slot="disagreements"
      className="border-border rounded-surface bg-card text-card-foreground flex min-w-0 flex-col gap-2 border p-3"
    >
      <header className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-medium">Disagreements</h3>
        <span className="text-muted-foreground text-meta">
          {count ? formatPlural(count, "point") : "No disagreements found"}
        </span>
      </header>
      <p className="text-muted-foreground text-meta">
        Compared {summary.sources.map((s) => s.label).join(", ")} with{" "}
        {summary.model_name} on {new Date(summary.created_at).toLocaleString()}.
        This does not say which is correct.{" "}
        {[
          (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) > 0 &&
            `${(usage.input_tokens ?? 0).toLocaleString()} in / ${(usage.output_tokens ?? 0).toLocaleString()} out tokens`,
          formatDuration(usage.duration_ms ?? 0),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {stale && (
        <p role="note" className="text-meta">
          An answer changed after this summary was made. Compare again to update
          it.
        </p>
      )}
      {usage.truncated && (
        <p className="text-meta">
          Only the first {usage.limit} points are shown.
        </p>
      )}
      {!!truncated.length && (
        <p className="text-meta">
          Only the beginning of {truncated.map((s) => s.label).join(", ")} was
          compared.
        </p>
      )}
      {!!count && (
        <ol className="flex flex-col gap-2">
          {summary.disagreements.map((item, index) => (
            <li
              key={index}
              className="border-border rounded-control flex flex-col gap-1.5 border p-2.5"
            >
              <p className="text-sm font-medium [overflow-wrap:anywhere]">
                {item.topic}
              </p>
              <ul className="flex flex-col gap-1.5">
                {item.positions.map((position) => {
                  const source = sources.get(position.source);
                  if (!source) return null;
                  return (
                    <li
                      key={position.source}
                      className="flex flex-wrap items-start gap-2"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="max-w-48 shrink-0"
                        aria-label={`Show ${source.label}`}
                        onClick={() => onShowSource(source)}
                      >
                        <Badge variant="outline" className="max-w-full">
                          <span className="truncate">{source.label}</span>
                        </Badge>
                        <ArrowUpRightIcon aria-hidden />
                      </Button>
                      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                        {position.claim}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Move focus to a source's column or agent entry, scrolling it into view. */
export function focusElement(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ block: "nearest" });
  element.focus({ preventScroll: true });
}
