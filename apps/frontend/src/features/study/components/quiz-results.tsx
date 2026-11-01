"use client";

import { PageHeaderSkeleton } from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type { StudyQuizAttempt, StudyQuizResult } from "@/lib/client";
import { studyQuizAttemptGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  VERDICT_LABELS,
  optionLetter,
  percentLabel,
  pointsLabel,
} from "../lib/quiz";
import { CardCitations } from "./card-citations";

export function QuizResults({
  projectId,
  quizId,
  attemptId,
}: {
  projectId: string;
  quizId: string;
  attemptId: string;
}) {
  const attempt = useQuery({
    ...studyQuizAttemptGetOneOptions({
      client,
      path: { project_id: projectId, quiz_id: quizId, attempt_id: attemptId },
    }),
    retry: false,
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
      {attempt.isPending && <PageHeaderSkeleton label="Loading results" />}
      {attempt.error && (
        <QueryError
          error={attempt.error}
          message="Could not load these results."
          retry={attempt.refetch}
          isRetrying={attempt.isFetching}
        />
      )}
      {attempt.data && (
        <>
          <PageHeader
            title={`Results: ${attempt.data.quiz_title}`}
            description={`Submitted ${new Date(attempt.data.submitted_at * 1000).toLocaleString()}`}
            actions={
              <Button asChild>
                <Link href={`${quizHref}/take`}>Retake quiz</Link>
              </Button>
            }
          />
          <ScoreSummary attempt={attempt.data} />
          <section aria-label="Answers" className="flex flex-col gap-4">
            <h2 className="text-heading">Answers</h2>
            <ol className="flex flex-col gap-4">
              {attempt.data.results.map((result, index) => (
                <ResultItem
                  key={result.question_id}
                  number={index + 1}
                  result={result}
                />
              ))}
            </ol>
          </section>
        </>
      )}
    </PageLayout>
  );
}

function ScoreSummary({ attempt }: { attempt: StudyQuizAttempt }) {
  return (
    <section
      aria-label="Score"
      className="rounded-surface flex flex-col gap-1 border p-4"
    >
      <p className="text-heading">
        {pointsLabel(attempt.score, attempt.question_count)} points (
        {percentLabel(attempt.score / attempt.question_count)})
      </p>
      <p className="text-muted-foreground text-sm">
        Multiple-choice answers are graded exactly. A partly correct short
        answer earns half a point.
        {attempt.grader_model_name &&
          ` Short answers were graded by ${attempt.grader_model_name}.`}
      </p>
      {attempt.ungraded_count > 0 && (
        <p role="alert" className="text-destructive text-sm">
          {attempt.ungraded_count === 1
            ? "1 answer could not be graded and earned no points."
            : `${attempt.ungraded_count} answers could not be graded and earned no points.`}{" "}
          Retake the quiz to grade them again.
        </p>
      )}
    </section>
  );
}

const VERDICT_BADGES = {
  correct: "default",
  partial: "secondary",
  incorrect: "destructive",
  ungraded: "outline",
} as const satisfies Record<StudyQuizResult["verdict"], string>;

function ResultItem({
  number,
  result,
}: {
  number: number;
  result: StudyQuizResult;
}) {
  return (
    <li
      aria-label={`Question ${number}: ${VERDICT_LABELS[result.verdict]}`}
      className="rounded-surface flex flex-col gap-3 border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <span className="font-medium">{number}.</span>{" "}
          {/* Generated text and learner answers are untrusted. */}
          <MarkdownViewer content={result.prompt} className="min-w-0" />
        </div>
        <Badge variant={VERDICT_BADGES[result.verdict]} className="shrink-0">
          {VERDICT_LABELS[result.verdict]}
        </Badge>
      </div>
      {result.kind === "multiple_choice" ? (
        <ul aria-label="Options" className="flex flex-col gap-1 text-sm">
          {result.options.map((option, index) => {
            const correct = index === result.correct_option;
            const chosen = index === result.choice;
            return (
              <li
                key={index}
                className={cn(
                  "rounded-control flex items-start gap-2 border px-2 py-1",
                  correct && "border-primary",
                  chosen && !correct && "border-destructive",
                )}
              >
                <span aria-hidden>{optionLetter(index)}.</span>
                <MarkdownViewer content={option} className="min-w-0 flex-1" />
                <span className="text-muted-foreground shrink-0 text-xs">
                  {[correct && "Correct answer", chosen && "Your answer"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            );
          })}
          {result.choice == null && (
            <li className="text-muted-foreground">You did not answer.</li>
          )}
        </ul>
      ) : (
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              Your answer
            </h3>
            {result.text ? (
              <MarkdownViewer content={result.text} />
            ) : (
              <p className="text-muted-foreground">You did not answer.</p>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              Rubric
            </h3>
            <MarkdownViewer content={result.rubric} />
          </div>
        </div>
      )}
      {result.explanation && (
        <div className="text-sm">
          <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Explanation
          </h3>
          <MarkdownViewer content={result.explanation} />
        </div>
      )}
      {result.grader === "model" && result.feedback && (
        <div className="text-sm">
          <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Feedback
          </h3>
          <MarkdownViewer content={result.feedback} />
        </div>
      )}
      {result.citations.length > 0 && (
        <CardCitations citations={result.citations} />
      )}
    </li>
  );
}
