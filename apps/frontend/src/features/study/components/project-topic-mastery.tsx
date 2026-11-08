"use client";

import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type { StudyTopicMastery, StudyTrendPoint } from "@/lib/client";
import {
  studyTopicMasteryGetManyOptions,
  studyTopicPracticeMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { studyErrorDetail } from "../lib/error-detail";
import { LEVEL_LABELS, percent, trendSummary } from "../lib/mastery";
import { HelpHeading } from "@/features/help/components/help-heading";

export const TOPIC_PRACTICE_QUESTIONS = 10;

/**
 * Mastery per topic (deck and quiz tags), from review ratings and quiz
 * results (US-58.3). Hidden until a deck or quiz has a topic.
 */
export function ProjectTopicMastery({ projectId }: { projectId: string }) {
  const router = useRouter();
  const topics = useQuery({
    ...studyTopicMasteryGetManyOptions({
      client,
      path: { project_id: projectId },
    }),
    retry: false,
  });
  const practice = useMutation({
    ...studyTopicPracticeMutation({ client }),
    onSuccess: (quiz) =>
      router.push(`/projects/${projectId}/study/quizzes/${quiz.id}/take`),
  });
  if (topics.error)
    return (
      <QueryError
        error={topics.error}
        message="Could not load topic mastery."
        retry={topics.refetch}
        isRetrying={topics.isFetching}
      />
    );
  if (!topics.data?.items.length) return null;
  const busy = practice.isPending || practice.isSuccess;
  return (
    <section aria-label="Topic mastery" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <HelpHeading help="concept.topic-mastery" className="text-heading">
          Topic mastery
        </HelpHeading>
        <p className="text-muted-foreground text-sm">
          From your latest review rating or quiz answer on each card and
          question tagged with the topic.
        </p>
      </div>
      {practice.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(practice.error, "Could not start practice.")}
        </p>
      )}
      <ul className="flex min-w-0 flex-col divide-y border-y">
        {topics.data.items.map((topic) => (
          <TopicRow
            key={topic.key}
            topic={topic}
            busy={busy}
            onPractice={() =>
              practice.mutate({
                path: { project_id: projectId },
                body: {
                  topic: topic.label,
                  question_count: TOPIC_PRACTICE_QUESTIONS,
                },
              })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function TopicRow({
  topic,
  busy,
  onPractice,
}: {
  topic: StudyTopicMastery;
  busy: boolean;
  onPractice: () => void;
}) {
  const summary = trendSummary(topic.trend);
  return (
    <li
      aria-label={topic.label}
      data-topic={topic.key}
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 py-3"
    >
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium wrap-anywhere">{topic.label}</span>
          <Badge
            variant={topic.level === "mastered" ? "default" : "secondary"}
            data-level={topic.level}
          >
            {LEVEL_LABELS[topic.level]}
          </Badge>
        </p>
        <p className="text-muted-foreground text-xs">
          {topic.score != null && `${percent(topic.score)} · `}
          {topic.practiced} of {topic.total} practiced
        </p>
      </div>
      <Sparkline trend={topic.trend} summary={summary} />
      <Button
        variant="outline"
        size="sm"
        disabled={busy || topic.total === 0}
        aria-label={`Practice ${topic.label}`}
        onClick={onPractice}
      >
        Practice
      </Button>
    </li>
  );
}

/** Weekly mastery as a small line; the summary carries the same information as text. */
function Sparkline({
  trend,
  summary,
}: {
  trend: readonly StudyTrendPoint[];
  summary: string;
}) {
  const width = 96;
  const height = 24;
  const step = trend.length > 1 ? width / (trend.length - 1) : width;
  const points = trend
    .map((point, index) =>
      point.score == null
        ? null
        : `${(index * step).toFixed(1)},${(height - 2 - point.score * (height - 4)).toFixed(1)}`,
    )
    .filter((point): point is string => point !== null);
  return (
    <span className="flex items-center" title={summary}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
        className="text-primary overflow-visible"
      >
        <line
          x1={0}
          x2={width}
          y1={height - 2}
          y2={height - 2}
          className="stroke-border"
          strokeWidth={1}
        />
        {points.length > 1 && (
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          />
        )}
        {points.length === 1 && (
          <circle
            cx={points[0].split(",")[0]}
            cy={points[0].split(",")[1]}
            r={2}
            fill="currentColor"
          />
        )}
      </svg>
      <span className="sr-only">{summary}</span>
    </span>
  );
}
