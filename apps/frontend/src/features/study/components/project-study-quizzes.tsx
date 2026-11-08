"use client";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import { studyQuizGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { percentLabel, questionCountLabel } from "../lib/quiz";
import { HelpHeading } from "@/features/help/components/help-heading";

const PAGE_SIZE = 20;

export function ProjectStudyQuizzes({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1);
  const quizzes = useQuery({
    ...studyQuizGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page, page_size: PAGE_SIZE },
    }),
    retry: false,
  });
  const newQuiz = (
    <Button asChild variant="outline">
      <Link href={`/projects/${projectId}/study/quizzes/new`}>New quiz</Link>
    </Button>
  );
  return (
    <section className="flex flex-col gap-4" aria-label="Practice quizzes">
      <div className="flex items-center justify-between">
        <HelpHeading help="concept.quiz" className="text-heading">
          Practice quizzes
        </HelpHeading>
        {quizzes.data && quizzes.data.total > 0 && newQuiz}
      </div>
      {quizzes.isPending && <ListSkeleton label="Loading quizzes" rows={2} />}
      {quizzes.error && (
        <QueryError
          error={quizzes.error}
          message={
            quizzes.data
              ? "Could not refresh quizzes. Showing saved results."
              : "Could not load quizzes."
          }
          retry={quizzes.refetch}
          isRetrying={quizzes.isFetching}
        />
      )}
      {quizzes.data &&
        (quizzes.data.total === 0 ? (
          <EmptyState
            title="No quizzes yet"
            description="Generate a quiz from this project's files to test yourself."
            action={newQuiz}
          />
        ) : (
          <>
            <ul className="divide-y">
              {quizzes.data.items.map((quiz) => (
                <li
                  key={quiz.id}
                  className="flex items-baseline justify-between gap-3 py-3"
                >
                  <Link
                    href={`/projects/${projectId}/study/quizzes/${quiz.id}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {quiz.title}
                  </Link>
                  <span className="flex shrink-0 items-baseline gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {questionCountLabel(quiz.question_count)}
                      {quiz.last_score != null &&
                        ` · last ${percentLabel(quiz.last_score)}`}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/projects/${projectId}/study/quizzes/${quiz.id}/take`}
                        aria-label={`Take ${quiz.title}`}
                      >
                        Take
                      </Link>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            {quizzes.data.total > PAGE_SIZE && (
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={page === 1 || quizzes.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  Previous quizzes
                </Button>
                <span className="text-muted-foreground text-sm">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  disabled={
                    page * PAGE_SIZE >= quizzes.data.total || quizzes.isFetching
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Next quizzes
                </Button>
              </div>
            )}
          </>
        ))}
    </section>
  );
}
