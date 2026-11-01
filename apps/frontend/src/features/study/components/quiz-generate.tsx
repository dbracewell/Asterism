"use client";

import { PageHeader, PageLayout } from "@/components/page-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client } from "@/lib/api";
import type {
  StudyQuizGenerateRequest,
  StudyQuizGeneration,
} from "@/lib/client";
import { studyQuizGenerateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";
import {
  MAX_QUIZ_QUESTIONS,
  QUIZ_TITLE_MAX,
  questionCountLabel,
} from "../lib/quiz";
import {
  SourceFilesFieldset,
  StudyModelField,
  useSourceFiles,
  useStudyModel,
} from "./source-fields";
import { PendingStatus } from "./pending-status";

type StudyQuestionKind = StudyQuizGenerateRequest["kinds"][number];

const KINDS: { value: StudyQuestionKind; label: string }[] = [
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "short_answer", label: "Short answer" },
];

export function QuizGenerate({ projectId }: { projectId: string }) {
  const [result, setResult] = useState<StudyQuizGeneration | null>(null);
  const generate = useMutation({
    ...studyQuizGenerateMutation({ client }),
    onSuccess: setResult,
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
        title="New practice quiz"
        description="Generate a quiz from this project's files. Each question cites the file it came from."
      />
      <QuizForm
        projectId={projectId}
        pending={generate.isPending}
        onSubmit={(body) => {
          setResult(null);
          generate.mutate({ path: { project_id: projectId }, body });
        }}
      />
      {generate.isPending && (
        <PendingStatus>
          Writing questions. This can take a minute or two.
        </PendingStatus>
      )}
      {generate.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(
            generate.error,
            "Could not generate a quiz. Try again.",
          )}
        </p>
      )}
      {result && !generate.isPending && (
        <GenerationResult projectId={projectId} result={result} />
      )}
    </PageLayout>
  );
}

function QuizForm({
  projectId,
  pending,
  onSubmit,
}: {
  projectId: string;
  pending: boolean;
  onSubmit: (body: StudyQuizGenerateRequest) => void;
}) {
  const [count, setCount] = useState("8");
  const [kinds, setKinds] = useState<StudyQuestionKind[]>([
    "multiple_choice",
    "short_answer",
  ]);
  const [title, setTitle] = useState("");
  const source = useSourceFiles(projectId);
  const choice = useStudyModel();
  const { model } = choice;
  const questions = Number(count);
  const validCount =
    Number.isInteger(questions) &&
    questions >= 1 &&
    questions <= MAX_QUIZ_QUESTIONS;
  const valid = !!model && validCount && kinds.length > 0 && source.valid;
  return (
    <form
      className="rounded-surface flex flex-col gap-5 border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !model) return;
        onSubmit({
          model_id: model,
          question_count: questions,
          // Keep a stable order regardless of the order boxes were ticked.
          kinds: KINDS.map((kind) => kind.value).filter((kind) =>
            kinds.includes(kind),
          ),
          file_ids: source.fileIds,
          title: title.trim() || null,
        });
      }}
    >
      <FieldGroup>
        <SourceFilesFieldset
          idPrefix="quiz"
          disabled={pending}
          source={source}
        />
        <FieldSet>
          <FieldLegend variant="label">Question types</FieldLegend>
          {KINDS.map((kind) => {
            const id = `quiz-kind-${kind.value}`;
            return (
              <div key={kind.value} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={kinds.includes(kind.value)}
                  disabled={pending}
                  onCheckedChange={(next) =>
                    setKinds(
                      next
                        ? [...kinds, kind.value]
                        : kinds.filter((item) => item !== kind.value),
                    )
                  }
                />
                <Label htmlFor={id}>{kind.label}</Label>
              </div>
            );
          })}
          <FieldDescription>
            {kinds.length === 0
              ? "Choose at least one question type."
              : "Short answers are graded by a model against a rubric."}
          </FieldDescription>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor="quiz-count">Number of questions</FieldLabel>
          <Input
            id="quiz-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_QUIZ_QUESTIONS}
            className="w-28"
            value={count}
            disabled={pending}
            aria-invalid={!validCount}
            onChange={(event) => setCount(event.target.value)}
          />
          <FieldDescription>
            From 1 to {MAX_QUIZ_QUESTIONS}, spread across the files.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="quiz-title">Title (optional)</FieldLabel>
          <Input
            id="quiz-title"
            data-1p-ignore
            maxLength={QUIZ_TITLE_MAX}
            value={title}
            disabled={pending}
            placeholder="Named after the files when left empty"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <StudyModelField id="quiz-model" disabled={pending} choice={choice} />
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Generating…" : "Generate quiz"}
        </Button>
      </div>
    </form>
  );
}

function GenerationResult({
  projectId,
  result,
}: {
  projectId: string;
  result: StudyQuizGeneration;
}) {
  const { quiz } = result;
  const quizHref = quiz && `/projects/${projectId}/study/quizzes/${quiz.id}`;
  return (
    <section aria-label="Generation result" className="flex flex-col gap-4">
      {quiz && quizHref ? (
        <div
          role="status"
          className="rounded-surface flex flex-wrap items-center justify-between gap-3 border p-4"
        >
          <p className="text-sm">
            Saved <span className="font-medium">{quiz.title}</span> with{" "}
            {questionCountLabel(quiz.question_count)}.
          </p>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={quizHref}>View quiz</Link>
            </Button>
            <Button asChild>
              <Link href={`${quizHref}/take`}>Start quiz</Link>
            </Button>
          </div>
        </div>
      ) : (
        <p role="alert" className="text-destructive text-sm">
          No questions were produced, so no quiz was saved. Check the file
          results below and try again.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h2 className="text-heading">Files</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {result.files.map((file) => (
            <li
              key={file.file_id}
              className="flex flex-wrap items-baseline gap-2"
            >
              <span className="font-medium">
                {file.file_name ?? "Unavailable file"}
              </span>
              {file.status === "used" ? (
                <span className="text-muted-foreground">
                  {questionCountLabel(file.question_count)}
                  {file.truncated && ". Only the start of this file was used."}
                </span>
              ) : (
                <span className="text-destructive">{file.message}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
