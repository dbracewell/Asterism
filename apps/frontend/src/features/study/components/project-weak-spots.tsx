"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type { StudyWeakSpot } from "@/lib/client";
import {
  studyWeakSpotGetManyOptions,
  studyWeakSpotPracticeMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { studyErrorDetail } from "../lib/error-detail";
import { questionCountLabel } from "../lib/quiz";

const SHOWN = 5;
export const PRACTICE_QUESTIONS = 10;

const OUTCOME_LABELS: Record<StudyWeakSpot["outcome"], string> = {
  incorrect: "Missed",
  partial: "Partly correct",
  again: "Rated Again",
};

export function weakSpotHref(projectId: string, spot: StudyWeakSpot) {
  return spot.source_kind === "card"
    ? `/projects/${projectId}/study/${spot.container_id}`
    : `/projects/${projectId}/study/quizzes/${spot.container_id}`;
}

/** Missed quiz questions and cards rated Again, with a practice action. Hidden until there are any. */
export function ProjectWeakSpots({ projectId }: { projectId: string }) {
  const router = useRouter();
  const spots = useQuery({
    ...studyWeakSpotGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { limit: SHOWN },
    }),
    retry: false,
  });
  const practice = useMutation({
    ...studyWeakSpotPracticeMutation({ client }),
    onSuccess: (quiz) =>
      router.push(`/projects/${projectId}/study/quizzes/${quiz.id}/take`),
  });
  if (spots.error)
    return (
      <QueryError
        error={spots.error}
        message="Could not load weak spots."
        retry={spots.refetch}
        isRetrying={spots.isFetching}
      />
    );
  if (!spots.data || spots.data.total === 0) return null;
  const { items, total } = spots.data;
  const count = Math.min(total, PRACTICE_QUESTIONS);
  const busy = practice.isPending || practice.isSuccess;
  return (
    <section aria-label="Weak spots" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-heading">Weak spots</h2>
          <span className="text-muted-foreground text-sm">
            {total === 1 ? "1 item to practice" : `${total} items to practice`}
          </span>
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            practice.mutate({
              path: { project_id: projectId },
              body: { question_count: count },
            })
          }
        >
          {busy ? "Building quiz…" : "Practice weak spots"}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Missed quiz questions and cards you rated Again, most recent first.
        Practice builds a quiz of {questionCountLabel(count)}; answering an item
        correctly here, in another quiz or in a review clears it.
      </p>
      {practice.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(
            practice.error,
            "Could not build a practice quiz. Try again.",
          )}
        </p>
      )}
      <ul className="divide-y">
        {items.map((spot) => (
          <li
            key={`${spot.root_kind}-${spot.root_id}`}
            className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            {/* Generated and learner text is untrusted. */}
            <MarkdownViewer
              content={spot.prompt}
              className="line-clamp-2 min-w-0"
            />
            <span className="flex shrink-0 items-baseline gap-2">
              <Badge
                variant={spot.outcome === "partial" ? "secondary" : "outline"}
              >
                {OUTCOME_LABELS[spot.outcome]}
              </Badge>
              <Link
                href={weakSpotHref(projectId, spot)}
                className="text-muted-foreground max-w-48 truncate hover:underline"
              >
                {spot.container_title}
              </Link>
            </span>
          </li>
        ))}
      </ul>
      {total > SHOWN && (
        <p className="text-muted-foreground text-sm">
          Showing the {SHOWN} most recent of {total}.
        </p>
      )}
    </section>
  );
}
