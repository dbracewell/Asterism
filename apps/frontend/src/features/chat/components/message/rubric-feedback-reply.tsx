"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { Badge } from "@/components/ui/badge";
import { learningModeQueryOptions } from "@/features/chat/components/chat-learning-mode-picker";
import {
  parseRubricFeedback,
  type ParsedCriterion,
} from "@/features/chat/lib/rubric-feedback";
import type { LearningModeId, RubricProvenance } from "@/lib/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheckIcon } from "lucide-react";
import { useId } from "react";

/**
 * An assistant reply in Draft feedback mode (US-57.1): one card per rubric
 * criterion with its estimated level, then the overall summary. The turn's
 * pinned rubric supplies the headings and levels; a reply that does not use
 * them, such as a request for a draft or an example rewrite, renders as
 * ordinary Markdown.
 */
export function RubricFeedbackReply({
  content,
  mode,
  rubric,
  className,
}: {
  content: string;
  mode: LearningModeId;
  rubric: RubricProvenance;
  className?: string;
}) {
  const catalog = useQuery(learningModeQueryOptions());
  const format = catalog.data?.modes.find(
    (item) => item.id === mode,
  )?.rubric_feedback;
  const feedback = format ? parseRubricFeedback(content, rubric, format) : null;
  if (!feedback)
    return <MarkdownViewer content={content} className={className} />;
  return (
    <div
      role="group"
      aria-label={`Feedback against ${rubric.name}`}
      className="flex w-full min-w-0 flex-col gap-3"
      data-rubric-feedback={rubric.id}
    >
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <ClipboardCheckIcon className="size-3.5 shrink-0" aria-hidden />
        Assessed against {rubric.name}. Levels are estimates.
      </p>
      {feedback.preamble && <MarkdownViewer content={feedback.preamble} />}
      {feedback.criteria.map((item) => (
        <CriterionBlock
          key={item.criterion}
          item={item}
          levelCount={rubric.levels.length}
        />
      ))}
      {feedback.overall !== null && (
        <OverallBlock
          heading={format!.overall_heading}
          body={feedback.overall}
        />
      )}
    </div>
  );
}

function CriterionBlock({
  item,
  levelCount,
}: {
  item: ParsedCriterion;
  levelCount: number;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-rubric-criterion={item.criterion}
      className="border-border rounded-surface flex min-w-0 flex-col gap-1.5 border px-3.5 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-foreground text-sm font-medium">
          {item.criterion}
        </h3>
        <LevelBadge item={item} levelCount={levelCount} />
      </div>
      {item.body && <MarkdownViewer content={item.body} />}
    </section>
  );
}

function LevelBadge({
  item,
  levelCount,
}: {
  item: ParsedCriterion;
  levelCount: number;
}) {
  if (item.level === null)
    return (
      <Badge variant="outline" data-rubric-level="missing">
        No level estimated
      </Badge>
    );
  const known = item.levelIndex !== null;
  // Levels are ordered highest first; the meter fills from the left.
  const filled = known ? levelCount - item.levelIndex! : 0;
  return (
    <Badge
      variant="secondary"
      className="max-w-full"
      data-rubric-level={known ? item.levelIndex : "unknown"}
      title={
        known
          ? `Estimated level ${filled} of ${levelCount}, where ${levelCount} is highest`
          : "This level is not one of the rubric's levels"
      }
    >
      <span className="sr-only">Estimated level: </span>
      <span className="truncate">{item.level}</span>
      {known ? (
        <span aria-hidden className="flex shrink-0 gap-0.5">
          {Array.from({ length: levelCount }, (_, index) => (
            <span
              key={index}
              className={cn(
                "rounded-dot size-1.5",
                index < filled ? "bg-foreground" : "bg-muted-foreground/30",
              )}
            />
          ))}
        </span>
      ) : (
        <span className="shrink-0">· not in rubric</span>
      )}
      {known && (
        <span className="sr-only">
          , {filled} of {levelCount}
        </span>
      )}
    </Badge>
  );
}

function OverallBlock({ heading, body }: { heading: string; body: string }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-rubric-overall
      className="bg-muted/40 rounded-surface flex min-w-0 flex-col gap-1.5 px-3.5 py-3"
    >
      <h3 id={headingId} className="text-foreground text-sm font-medium">
        {heading}
      </h3>
      {body && <MarkdownViewer content={body} />}
    </section>
  );
}
