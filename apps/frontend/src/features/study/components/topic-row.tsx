"use client";

import { Badge } from "@/components/ui/badge";
import type { StudyTopicMastery, StudyTrendPoint } from "@/lib/client";
import { LEVEL_LABELS, percent, trendSummary } from "../lib/mastery";

/** One topic's level, score, coverage and weekly trend (ADR-0049). */
export function TopicRow({ topic }: { topic: StudyTopicMastery }) {
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
