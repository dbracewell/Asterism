import type { StudyTopicMastery, StudyTrendPoint } from "@/lib/client";

type MasteryLevel = StudyTopicMastery["level"];

export const LEVEL_LABELS: Record<MasteryLevel, string> = {
  not_started: "Not started",
  needs_work: "Needs work",
  developing: "Developing",
  mastered: "Mastered",
};

export const percent = (score: number) => `${Math.round(score * 100)}%`;

/** A sentence describing the weekly trend, for screen readers and tooltips. */
export function trendSummary(trend: readonly StudyTrendPoint[]): string {
  const scored = trend.filter(
    (point): point is { at: number; score: number } => point.score != null,
  );
  if (!scored.length) return "Not practiced yet.";
  const first = scored[0].score;
  const last = scored[scored.length - 1].score;
  if (scored.length === 1)
    return `First practiced recently, at ${percent(last)}.`;
  const weeks = trend.length;
  if (Math.round(first * 100) === Math.round(last * 100))
    return `Steady at ${percent(last)} over the last ${weeks} weeks.`;
  return `${last > first ? "Up" : "Down"} from ${percent(first)} to ${percent(last)} over the last ${weeks} weeks.`;
}
