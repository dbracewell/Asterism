"use client";

import { QueryError } from "@/components/query-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { client } from "@/lib/api";
import type { RecordedRun } from "@/lib/client";
import { chatRunGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import React, { useId, useState } from "react";
import {
  agentRows,
  capabilityChanges,
  type FactRow,
  finalAnswer,
  textDiff,
  toolRows,
  usageRows,
} from "../lib/run-diff";

/** A run to compare: any message of it, and how to name it. */
export type RunChoice = { messageId: string; label: string };

/**
 * Run diff (US-54.6): compare two recorded runs on different branches, such
 * as comparison columns, a fork and its original, or a regeneration. Shows a
 * text diff of the final answers and the differences in agents, models,
 * tools called, usage and capabilities. Answers are untrusted and render as
 * plain text.
 */
export function RunDiffDialog({
  chatId,
  choices,
  defaultBefore = 0,
  defaultAfter = 1,
  triggerLabel = "Diff",
  className,
}: {
  chatId: string;
  /** At least two runs; the user picks which two to compare. */
  choices: RunChoice[];
  defaultBefore?: number;
  defaultAfter?: number;
  triggerLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (choices.length < 2) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-slot="run-diff"
        className={cn(
          "rounded-control hover:text-foreground focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
          className,
        )}
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Run diff</DialogTitle>
          <DialogDescription>
            What changed between two runs, from what each run recorded.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <RunDiffBody
            chatId={chatId}
            choices={choices}
            defaultBefore={defaultBefore}
            defaultAfter={defaultAfter}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RunPicker({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: RunChoice[];
  value: number;
  onChange: (index: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={String(value)}
        onValueChange={(next) => onChange(Number(next))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice, index) => (
            <SelectItem key={choice.messageId} value={String(index)}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const runQuery = (chatId: string, messageId: string) =>
  chatRunGetOptions({
    client,
    path: { chat_id: chatId, message_id: messageId },
  });

function RunDiffBody({
  chatId,
  choices,
  defaultBefore,
  defaultAfter,
}: {
  chatId: string;
  choices: RunChoice[];
  defaultBefore: number;
  defaultAfter: number;
}) {
  const [before, setBefore] = useState(defaultBefore);
  const [after, setAfter] = useState(defaultAfter);
  const left = useQuery(runQuery(chatId, choices[before].messageId));
  const right = useQuery(runQuery(chatId, choices[after].messageId));
  const error = left.error ?? right.error;

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      {choices.length > 2 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <RunPicker
            label="Before"
            choices={choices}
            value={before}
            onChange={setBefore}
          />
          <RunPicker
            label="After"
            choices={choices}
            value={after}
            onChange={setAfter}
          />
        </div>
      )}
      {error ? (
        <QueryError
          error={error}
          message="These runs couldn't be loaded."
          retry={() => {
            void left.refetch();
            void right.refetch();
          }}
          isRetrying={left.isFetching || right.isFetching}
        />
      ) : !left.data || !right.data ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : before === after ? (
        <p className="text-muted-foreground">
          Choose two different runs to compare.
        </p>
      ) : (
        <RunDiff
          before={left.data}
          after={right.data}
          beforeLabel={choices[before].label}
          afterLabel={choices[after].label}
        />
      )}
    </div>
  );
}

function RunDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: RecordedRun;
  after: RecordedRun;
  beforeLabel: string;
  afterLabel: string;
}) {
  const answer = React.useMemo(
    () => textDiff(finalAnswer(before), finalAnswer(after)),
    [before, after],
  );
  const capabilities = React.useMemo(
    () => capabilityChanges(before, after),
    [before, after],
  );
  return (
    <div className="flex max-h-[65vh] min-w-0 flex-col gap-5 overflow-y-auto pr-1">
      <section
        aria-labelledby="run-diff-answer"
        className="flex flex-col gap-2"
      >
        <h3 id="run-diff-answer" className="font-medium">
          Final answer
        </h3>
        {answer.every((part) => part.kind === "same") ? (
          <p className="text-muted-foreground">The answers are the same.</p>
        ) : (
          <p
            aria-label="Answer changes"
            className="bg-muted/60 rounded-surface border px-3 py-2 [overflow-wrap:anywhere] whitespace-pre-wrap"
          >
            {answer.map((part, index) =>
              part.kind === "added" ? (
                <ins
                  key={index}
                  className="bg-primary/15 text-foreground no-underline"
                >
                  {part.text}
                </ins>
              ) : part.kind === "removed" ? (
                <del key={index} className="bg-destructive/15 text-destructive">
                  {part.text}
                </del>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </p>
        )}
      </section>
      <FactTable
        title="Agents and models"
        rows={agentRows(before, after)}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
      />
      <FactTable
        title="Tools called"
        rows={toolRows(before, after)}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
        empty="Neither run called a tool."
      />
      <FactTable
        title="Usage"
        rows={usageRows(before, after)}
        beforeLabel={beforeLabel}
        afterLabel={afterLabel}
      />
      <section aria-label="Capabilities" className="flex flex-col gap-2">
        <h3 className="font-medium">Capabilities</h3>
        {capabilities.length === 0 ? (
          <p className="text-muted-foreground">
            Each agent had the same capabilities in both runs.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {capabilities.map((change) => (
              <li key={change.agent} className="flex flex-col gap-0.5">
                <span className="font-medium">{change.agent}</span>
                {change.missing && (
                  <span className="text-muted-foreground">
                    Not in{" "}
                    {change.missing === "before" ? beforeLabel : afterLabel} (or
                    no manifest was recorded).
                  </span>
                )}
                {change.added.length > 0 && (
                  <span>
                    Only in {afterLabel}: {change.added.join(", ")}
                  </span>
                )}
                {change.removed.length > 0 && (
                  <span>
                    Only in {beforeLabel}: {change.removed.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FactTable({
  title,
  rows,
  beforeLabel,
  afterLabel,
  empty,
}: {
  title: string;
  rows: FactRow[];
  beforeLabel: string;
  afterLabel: string;
  empty?: string;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <div role="table" aria-label={title} className="flex flex-col">
          <div
            role="row"
            className="text-muted-foreground grid grid-cols-3 gap-2 border-b pb-1 text-xs"
          >
            <span role="columnheader" />
            <span role="columnheader">{beforeLabel}</span>
            <span role="columnheader">{afterLabel}</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.label}
              role="row"
              data-changed={row.changed || undefined}
              className={cn(
                "grid grid-cols-3 gap-2 border-b py-1 [overflow-wrap:anywhere]",
                row.changed && "font-medium",
              )}
            >
              <span role="rowheader">{row.label}</span>
              <span role="cell">{row.before}</span>
              <span role="cell">
                {row.after}
                {row.changed && <span className="sr-only"> (changed)</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
