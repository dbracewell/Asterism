"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { EmptyState } from "@/components/empty-state";
import {
  ListSkeleton,
  PageHeaderSkeleton,
} from "@/components/loading-skeletons";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import type { StudyQuiz } from "@/lib/client";
import {
  studyQuizAttemptGetManyOptions,
  studyQuizDeleteMutation,
  studyQuizGetOneOptions,
  studyQuizUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatTags, parseTags, tagProblem } from "../lib/tags";
import { TagList, TagsField } from "./tags";
import { studyErrorDetail } from "../lib/error-detail";
import {
  QUIZ_TITLE_MAX,
  percentLabel,
  pointsLabel,
  questionCountLabel,
} from "../lib/quiz";

const PAGE_SIZE = 20;

export function quizDescription(quiz: StudyQuiz) {
  const parts = [questionCountLabel(quiz.question_count)];
  if (quiz.multiple_choice_count && quiz.short_answer_count)
    parts.push(
      `${quiz.multiple_choice_count} multiple choice, ${quiz.short_answer_count} short answer`,
    );
  parts.push(
    quiz.origin === "weak_spots"
      ? "built from your weak spots"
      : `written by ${quiz.model_name ?? "an unknown model"}`,
  );
  return parts.join(" · ");
}

export function QuizPage({
  projectId,
  quizId,
}: {
  projectId: string;
  quizId: string;
}) {
  const router = useRouter();
  const path = { project_id: projectId, quiz_id: quizId };
  const quiz = useQuery({
    ...studyQuizGetOneOptions({ client, path }),
    retry: false,
  });
  const [renaming, setRenaming] = useState(false);
  const remove = useMutation({
    ...studyQuizDeleteMutation({ client }),
    onSuccess: () => router.push(`/projects/${projectId}`),
  });
  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${quiz.data?.title ?? "quiz"}?`,
    description:
      "The quiz and all of its attempts will be deleted. Project files are not affected.",
    confirmVariant: "destructive",
    confirmText: "Delete quiz",
  });
  return (
    <PageLayout>
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to project
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
            actions={
              <>
                <Button asChild>
                  <Link
                    href={`/projects/${projectId}/study/quizzes/${quizId}/take`}
                  >
                    {quiz.data.attempt_count > 0 ? "Retake quiz" : "Take quiz"}
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => setRenaming(true)}>
                  Edit details
                </Button>
                <Button
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (await confirm()) remove.mutate({ path });
                  }}
                >
                  {remove.isPending ? "Deleting…" : "Delete quiz"}
                </Button>
              </>
            }
          />
          {remove.error && (
            <p role="alert" className="text-destructive text-sm">
              {studyErrorDetail(remove.error, "Could not delete the quiz.")}
            </p>
          )}
          <TagList tags={quiz.data.tags} />
          {quiz.data.attempt_count > 0 &&
            quiz.data.best_score != null &&
            quiz.data.last_score != null && (
              <p className="text-sm">
                Best {percentLabel(quiz.data.best_score)} · Last{" "}
                {percentLabel(quiz.data.last_score)}
              </p>
            )}
          <AttemptHistory projectId={projectId} quizId={quizId} />
          <RenameDialog
            projectId={projectId}
            quiz={quiz.data}
            open={renaming}
            onOpenChange={setRenaming}
          />
        </>
      )}
      {dialog}
    </PageLayout>
  );
}

function AttemptHistory({
  projectId,
  quizId,
}: {
  projectId: string;
  quizId: string;
}) {
  const [page, setPage] = useState(1);
  const attempts = useQuery({
    ...studyQuizAttemptGetManyOptions({
      client,
      path: { project_id: projectId, quiz_id: quizId },
      query: { page, page_size: PAGE_SIZE },
    }),
    retry: false,
  });
  return (
    <section aria-label="Attempts" className="flex flex-col gap-3">
      <h2 className="text-heading">Attempts</h2>
      {attempts.isPending && <ListSkeleton label="Loading attempts" rows={2} />}
      {attempts.error && (
        <QueryError
          error={attempts.error}
          message="Could not load attempts."
          retry={attempts.refetch}
          isRetrying={attempts.isFetching}
        />
      )}
      {attempts.data &&
        (attempts.data.total === 0 ? (
          <EmptyState
            title="No attempts yet"
            description="Take the quiz to see your results here."
          />
        ) : (
          <>
            <ul className="divide-y">
              {attempts.data.items.map((attempt) => {
                const when = new Date(
                  attempt.submitted_at * 1000,
                ).toLocaleString();
                return (
                  <li
                    key={attempt.id}
                    className="flex flex-wrap items-baseline justify-between gap-3 py-3 text-sm"
                  >
                    <Link
                      href={`/projects/${projectId}/study/quizzes/${quizId}/attempts/${attempt.id}`}
                      className="hover:underline"
                    >
                      {when}
                    </Link>
                    <span className="text-muted-foreground">
                      {pointsLabel(attempt.score, attempt.question_count)} (
                      {percentLabel(attempt.score / attempt.question_count)})
                      {attempt.ungraded_count > 0 &&
                        ` · ${attempt.ungraded_count} not graded`}
                    </span>
                  </li>
                );
              })}
            </ul>
            {attempts.data.total > PAGE_SIZE && (
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={page === 1 || attempts.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  Newer attempts
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    page * PAGE_SIZE >= attempts.data.total ||
                    attempts.isFetching
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Older attempts
                </Button>
              </div>
            )}
          </>
        ))}
    </section>
  );
}

function RenameDialog({
  projectId,
  quiz,
  open,
  onOpenChange,
}: {
  projectId: string;
  quiz: StudyQuiz;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <RenameForm
            projectId={projectId}
            quiz={quiz}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  projectId,
  quiz,
  onDone,
}: {
  projectId: string;
  quiz: StudyQuiz;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(quiz.title);
  const [tags, setTags] = useState(formatTags(quiz.tags));
  const parsedTags = parseTags(tags);
  const invalidTags = !!tagProblem(parsedTags);
  const update = useMutation({
    ...studyQuizUpdateMutation({ client }),
    onSuccess: onDone,
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || invalidTags) return;
        update.mutate({
          path: { project_id: projectId, quiz_id: quiz.id },
          body: { title: title.trim(), tags: parsedTags },
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit quiz</DialogTitle>
        <DialogDescription>
          Questions stay the same; you can change the title and topics.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="quiz-rename">Title</FieldLabel>
        <Input
          id="quiz-rename"
          required
          data-1p-ignore
          maxLength={QUIZ_TITLE_MAX}
          value={title}
          disabled={update.isPending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <TagsField
        id="quiz-tags"
        value={tags}
        onChange={setTags}
        disabled={update.isPending}
      />
      {update.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(update.error, "Could not save the quiz.")}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={update.isPending || !title.trim() || invalidTags}
        >
          {update.isPending ? "Saving…" : "Save quiz"}
        </Button>
      </DialogFooter>
    </form>
  );
}
