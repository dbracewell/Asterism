"use client";

import { PageHeaderSkeleton } from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type {
  StudyQuiz,
  StudyQuizAnswerInput,
  StudyQuizQuestion,
} from "@/lib/client";
import {
  studyQuizAttemptSubmitMutation,
  studyQuizGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";
import { QUIZ_RESPONSE_MAX, optionLetter } from "../lib/quiz";
import { quizDescription } from "./quiz-page";
import { StudyModelField, useStudyModel } from "./source-fields";
import { PendingStatus } from "./pending-status";

type Answer = { choice?: number; text?: string };

/** Answers in the wire shape; untouched questions are omitted (unanswered). */
export function answerInputs(
  quiz: StudyQuiz,
  answers: Record<string, Answer>,
): StudyQuizAnswerInput[] {
  return quiz.questions.flatMap((question): StudyQuizAnswerInput[] => {
    const answer = answers[question.id];
    if (question.kind === "multiple_choice")
      return answer?.choice != null
        ? [{ question_id: question.id, choice: answer.choice }]
        : [];
    const text = answer?.text?.trim();
    return text ? [{ question_id: question.id, text }] : [];
  });
}

export function QuizTake({
  projectId,
  quizId,
}: {
  projectId: string;
  quizId: string;
}) {
  const quiz = useQuery({
    ...studyQuizGetOneOptions({
      client,
      path: { project_id: projectId, quiz_id: quizId },
    }),
    retry: false,
    // A background refetch must never disturb answers in progress.
    refetchOnWindowFocus: false,
  });
  const quizHref = `/projects/${projectId}/study/quizzes/${quizId}`;
  return (
    <PageLayout>
      <Link
        href={quizHref}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to quiz
      </Link>
      {quiz.isPending && <PageHeaderSkeleton label="Loading quiz" />}
      {quiz.error && (
        <QueryError
          error={quiz.error}
          message="Could not load this quiz."
          retry={quiz.refetch}
          isRetrying={quiz.isFetching}
        />
      )}
      {quiz.data && (
        <>
          <PageHeader
            title={quiz.data.title}
            description={quizDescription(quiz.data)}
          />
          <QuizForm projectId={projectId} quiz={quiz.data} />
        </>
      )}
    </PageLayout>
  );
}

function QuizForm({ projectId, quiz }: { projectId: string; quiz: StudyQuiz }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const needsGrader = quiz.short_answer_count > 0;
  const choice = useStudyModel(quiz.model_id);
  const submit = useMutation({
    ...studyQuizAttemptSubmitMutation({ client }),
    onSuccess: (attempt) =>
      router.push(
        `/projects/${projectId}/study/quizzes/${quiz.id}/attempts/${attempt.id}`,
      ),
  });
  const inputs = answerInputs(quiz, answers);
  const unanswered = quiz.questions.length - inputs.length;
  const writesShortAnswers = inputs.some((input) => input.text != null);
  const blocked = writesShortAnswers && !choice.model;
  const busy = submit.isPending || submit.isSuccess;
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || blocked) return;
        submit.mutate({
          path: { project_id: projectId, quiz_id: quiz.id },
          body: {
            answers: inputs,
            model_id: writesShortAnswers ? choice.model : null,
          },
        });
      }}
    >
      <ol className="flex flex-col gap-6">
        {quiz.questions.map((question, index) => (
          <li key={question.id}>
            <QuestionField
              number={index + 1}
              question={question}
              answer={answers[question.id]}
              disabled={busy}
              onChange={(answer) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: answer,
                }))
              }
            />
          </li>
        ))}
      </ol>
      <div className="rounded-surface flex flex-col gap-4 border p-4">
        {needsGrader && (
          <StudyModelField
            id="quiz-grader"
            label="Grading model"
            description="Grades your short answers against each question's rubric."
            disabled={busy}
            choice={choice}
          />
        )}
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {unanswered === 0
            ? "All questions answered."
            : `${unanswered} of ${quiz.questions.length} unanswered. Unanswered questions count as incorrect.`}
        </p>
        {submit.error && (
          <p role="alert" className="text-destructive text-sm">
            {studyErrorDetail(
              submit.error,
              "Could not submit your answers. Try again.",
            )}
          </p>
        )}
        {submit.isPending && (
          <PendingStatus>
            {writesShortAnswers
              ? "Grading your answers. Short answers can take a moment."
              : "Grading your answers."}
          </PendingStatus>
        )}
        <div>
          <Button type="submit" disabled={busy || blocked}>
            {busy ? "Submitting…" : "Submit answers"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function QuestionField({
  number,
  question,
  answer,
  disabled,
  onChange,
}: {
  number: number;
  question: StudyQuizQuestion;
  answer: Answer | undefined;
  disabled: boolean;
  onChange: (answer: Answer) => void;
}) {
  const promptId = `question-${question.id}-prompt`;
  const heading = (
    <div id={promptId} className="flex gap-2">
      <span className="font-medium">{number}.</span>{" "}
      {/* Generated text is untrusted. */}
      <MarkdownViewer content={question.prompt} className="min-w-0" />
    </div>
  );
  if (question.kind === "short_answer") {
    const id = `question-${question.id}-answer`;
    return (
      <Field className="rounded-surface border p-4">
        {heading}
        <FieldLabel htmlFor={id} className="sr-only">
          Your answer to question {number}
        </FieldLabel>
        <Textarea
          id={id}
          maxLength={QUIZ_RESPONSE_MAX}
          value={answer?.text ?? ""}
          disabled={disabled}
          aria-describedby={promptId}
          placeholder="Write a short answer"
          onChange={(event) => onChange({ text: event.target.value })}
        />
        <FieldDescription>Short answer · graded by a model</FieldDescription>
      </Field>
    );
  }
  return (
    <FieldSet className="rounded-surface border p-4">
      <FieldLegend className="sr-only">Question {number}</FieldLegend>
      {heading}
      <RadioGroup
        value={answer?.choice != null ? String(answer.choice) : ""}
        onValueChange={(value) => onChange({ choice: Number(value) })}
        disabled={disabled}
        aria-labelledby={promptId}
      >
        {question.options.map((option, index) => {
          const id = `question-${question.id}-option-${index}`;
          return (
            <div key={index} className="flex items-start gap-2">
              <RadioGroupItem value={String(index)} id={id} className="mt-1" />
              <Label htmlFor={id} className="flex min-w-0 gap-2 font-normal">
                <span aria-hidden>{optionLetter(index)}.</span>
                <MarkdownViewer content={option} className="min-w-0" />
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </FieldSet>
  );
}
