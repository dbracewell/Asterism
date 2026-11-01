"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import type {
  StudyGuideDraft,
  StudyGuideLink,
  StudyGuideRequest,
} from "@/lib/client";
import { studyGuideGenerateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { addDays, daySpan, formatDay, isoDate } from "../lib/dates";
import { studyErrorDetail } from "../lib/error-detail";
import { SaveNote } from "./save-note";
import { StudyModelField, useStudyModel } from "./source-fields";
import { PendingStatus } from "./pending-status";

export const MAX_GUIDE_DAYS = 60;

export function guideLinkHref(projectId: string, link: StudyGuideLink) {
  return link.kind === "quiz"
    ? `/projects/${projectId}/study/quizzes/${link.id}`
    : `/projects/${projectId}/study/${link.id}`;
}

export function GuideGenerate({ projectId }: { projectId: string }) {
  const [draft, setDraft] = useState<StudyGuideDraft | null>(null);
  const [version, setVersion] = useState(0);
  const generate = useMutation({
    ...studyGuideGenerateMutation({ client }),
    // Planning changes nothing on the server.
    meta: { skipGlobalInvalidation: true },
    onSuccess: (result) => {
      setDraft(result);
      setVersion((current) => current + 1);
    },
  });
  const { confirm, dialog } = useConfirmationDialog({
    title: "Replace this plan?",
    description: "The current plan has not been saved and will be lost.",
    confirmText: "Plan again",
  });
  return (
    <PageLayout>
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to project
      </Link>
      <PageHeader
        title="Plan for an exam"
        description="Get a day-by-day study plan up to your exam, linked to this project's decks and quizzes. Nothing is saved until you save it as a note."
      />
      <GuideForm
        pending={generate.isPending}
        onSubmit={async (body) => {
          if (draft && !(await confirm())) return;
          generate.mutate({ path: { project_id: projectId }, body });
        }}
      />
      {generate.isPending && (
        <PendingStatus>Planning your study days.</PendingStatus>
      )}
      {generate.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(
            generate.error,
            "Could not write a study plan. Try again.",
          )}
        </p>
      )}
      {draft && !generate.isPending && (
        <GuideDraftView key={version} projectId={projectId} draft={draft} />
      )}
      {dialog}
    </PageLayout>
  );
}

function GuideForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (body: StudyGuideRequest) => void;
}) {
  const [today] = useState(() => new Date());
  const [start, setStart] = useState(() => isoDate(today));
  const [exam, setExam] = useState(() => isoDate(addDays(today, 7)));
  const [minutes, setMinutes] = useState("60");
  const choice = useStudyModel();
  const { model } = choice;
  const span = daySpan(start, exam);
  const validSpan =
    Number.isFinite(span) && span >= 1 && span <= MAX_GUIDE_DAYS;
  const perDay = Number(minutes);
  const validMinutes =
    Number.isInteger(perDay) && perDay >= 10 && perDay <= 480;
  const valid = !!model && validSpan && validMinutes;
  return (
    <form
      className="rounded-surface flex flex-col gap-5 border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !model) return;
        onSubmit({
          model_id: model,
          start_date: start,
          exam_date: exam,
          minutes_per_day: perDay,
        });
      }}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="guide-start">Start date</FieldLabel>
            <Input
              id="guide-start"
              type="date"
              value={start}
              disabled={pending}
              onChange={(event) => setStart(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="guide-exam">Exam date</FieldLabel>
            <Input
              id="guide-exam"
              type="date"
              value={exam}
              min={start}
              disabled={pending}
              aria-invalid={!validSpan}
              aria-describedby="guide-span"
              onChange={(event) => setExam(event.target.value)}
            />
          </Field>
        </div>
        <FieldDescription id="guide-span">
          {validSpan
            ? span === 1
              ? "1 day to plan."
              : `${span} days to plan.`
            : `Choose an exam date on or after the start date, at most ${MAX_GUIDE_DAYS} days away.`}
        </FieldDescription>
        <Field>
          <FieldLabel htmlFor="guide-minutes">Minutes per day</FieldLabel>
          <Input
            id="guide-minutes"
            type="number"
            inputMode="numeric"
            min={10}
            max={480}
            className="w-28"
            value={minutes}
            disabled={pending}
            aria-invalid={!validMinutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
          <FieldDescription>From 10 to 480.</FieldDescription>
        </Field>
        <StudyModelField id="guide-model" disabled={pending} choice={choice} />
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Planning…" : "Plan study days"}
        </Button>
      </div>
    </form>
  );
}

function GuideDraftView({
  projectId,
  draft,
}: {
  projectId: string;
  draft: StudyGuideDraft;
}) {
  return (
    <>
      <section aria-label="Study plan" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-heading">Study plan</h2>
          <p className="text-muted-foreground text-sm">
            Exam on {formatDay(draft.exam_date)}. About {draft.minutes_per_day}{" "}
            minutes a day. Days without an entry are rest days.
          </p>
        </div>
        <ol className="flex flex-col gap-3">
          {draft.days.map((day) => (
            <li
              key={day.date}
              aria-label={formatDay(day.date)}
              className="rounded-surface flex flex-col gap-2 border p-4"
            >
              <h3 className="font-medium">{formatDay(day.date)}</h3>
              {day.focus && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Focus: </span>
                  {day.focus}
                </p>
              )}
              {day.tasks.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {day.tasks.map((task, index) => (
                    <li key={index}>
                      {/* Generated text is untrusted; render it as plain text. */}
                      {task.text}
                      {task.minutes != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({task.minutes} min)
                        </span>
                      )}
                      {task.link && (
                        <>
                          {" · "}
                          <Link
                            href={guideLinkHref(projectId, task.link)}
                            className="underline underline-offset-2"
                          >
                            {task.link.title}
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
      <SaveNote
        projectId={projectId}
        kind="study_guide"
        defaultTitle={draft.title}
        body={draft.body}
        modelId={draft.model_id}
      />
    </>
  );
}
