"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HelpHeading } from "@/features/help/components/help-heading";
import { client } from "@/lib/api";
import type {
  StudyProgress,
  StudyTopicMastery,
  StudyUnclearItem,
  StudyWeakSpot,
} from "@/lib/client";
import {
  studyDeckGetManyOptions,
  studyPracticeCreateMutation,
  studyProgressGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { questionCountLabel } from "../lib/quiz";
import { TopicRow } from "./topic-row";
import { UnclearItemForm } from "./unclear-item-form";

/** The section's anchor, so other pages can link to it. */
export const PROGRESS_ANCHOR = "progress";
export const PRACTICE_QUESTIONS = 10;
const SHOWN = 5;
const ALL = "all";
const NEW_DECK = "new";
const UNCLEAR_DECK_NAME = "Unclear items";

const OUTCOME_LABELS: Record<StudyWeakSpot["outcome"], string> = {
  incorrect: "Missed",
  partial: "Partly correct",
  again: "Rated Again",
  unclear: "Flagged as unclear",
};

export function weakSpotHref(projectId: string, spot: StudyWeakSpot) {
  return spot.source_kind === "card"
    ? `/projects/${projectId}/study/${spot.container_id}`
    : `/projects/${projectId}/study/quizzes/${spot.container_id}`;
}

/**
 * Topics, items that need practice and unclear items from reflections, from
 * one read (ADR-0067). The topic filter scopes the list and Practice.
 */
export function ProjectProgress({ projectId }: { projectId: string }) {
  const id = useId();
  const router = useRouter();
  const [filter, setFilter] = useState(ALL);
  const progress = useQuery({
    ...studyProgressGetOptions({ client, path: { project_id: projectId } }),
    retry: false,
  });
  const practice = useMutation({
    ...studyPracticeCreateMutation({ client }),
    onSuccess: (quiz) =>
      router.push(`/projects/${projectId}/study/quizzes/${quiz.id}/take`),
  });
  const data = progress.data;
  // A filter on a topic that is gone (untagged meanwhile) falls back to all.
  const topic = data?.topics.find((item) => item.key === filter);
  const available = topic ? topic.total : (data?.weak_spots.total ?? 0);
  const count = Math.min(available, PRACTICE_QUESTIONS);
  const busy = practice.isPending || practice.isSuccess;
  return (
    <section
      id={PROGRESS_ANCHOR}
      aria-label="Progress"
      className="flex scroll-mt-4 flex-col gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-heading">Progress</h2>
          <p className="text-muted-foreground text-sm">
            From your review ratings, quiz answers and reflections in this
            project.
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap items-end gap-2">
            {data.topics.length > 0 && (
              <Field className="w-auto">
                <FieldLabel htmlFor={`${id}-topic`}>Topic</FieldLabel>
                <Select
                  value={topic ? topic.key : ALL}
                  onValueChange={setFilter}
                >
                  <SelectTrigger id={`${id}-topic`} className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All topics</SelectItem>
                    {data.topics.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Button
              disabled={busy || count === 0}
              onClick={() =>
                practice.mutate({
                  path: { project_id: projectId },
                  body: {
                    topic: topic?.label ?? null,
                    question_count: count,
                  },
                })
              }
            >
              {busy
                ? "Building quiz…"
                : topic
                  ? `Practice ${topic.label}`
                  : "Practice weak spots"}
            </Button>
          </div>
        )}
      </div>
      {data && count > 0 && (
        <p className="text-muted-foreground text-sm">
          Practice builds a quiz of {questionCountLabel(count)}
          {topic
            ? ` from ${topic.label}, weakest items first.`
            : " from the most recent items that need practice."}{" "}
          Answering an item correctly anywhere clears it.
        </p>
      )}
      {practice.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(
            practice.error,
            "Could not build a practice quiz. Try again.",
          )}
        </p>
      )}
      {progress.isPending && (
        <ListSkeleton label="Loading progress" rows={3} detail />
      )}
      {progress.error && (
        <QueryError
          error={progress.error}
          message="Could not load progress."
          retry={progress.refetch}
          isRetrying={progress.isFetching}
        />
      )}
      {data && (
        <>
          <Topics topics={data.topics} selected={topic?.key} />
          <NeedsPractice projectId={projectId} data={data} topic={topic} />
          <FromReflections
            projectId={projectId}
            items={data.unclear.items}
            total={data.unclear.total}
          />
        </>
      )}
    </section>
  );
}

function Topics({
  topics,
  selected,
}: {
  topics: StudyTopicMastery[];
  selected: string | undefined;
}) {
  return (
    <section aria-label="Topics" className="flex flex-col gap-2">
      <HelpHeading
        help="concept.topic-mastery"
        className="text-sm font-medium"
        as="h3"
      >
        Topics
      </HelpHeading>
      {topics.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No topics yet. Add a topic to a deck or quiz to see how well you know
          it.
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y border-y">
          {topics
            .filter((item) => !selected || item.key === selected)
            .map((item) => (
              <TopicRow key={item.key} topic={item} />
            ))}
        </ul>
      )}
    </section>
  );
}

function NeedsPractice({
  projectId,
  data,
  topic,
}: {
  projectId: string;
  data: StudyProgress;
  topic: StudyTopicMastery | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const { total } = data.weak_spots;
  const items = topic
    ? data.weak_spots.items.filter((spot) => spot.topics.includes(topic.key))
    : data.weak_spots.items;
  const shown = expanded ? items : items.slice(0, SHOWN);
  const practiced = data.topics.some((item) => item.practiced > 0);
  return (
    <section aria-label="Needs practice" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <HelpHeading
          help="concept.weak-spot"
          className="text-sm font-medium"
          as="h3"
        >
          Needs practice
        </HelpHeading>
        {items.length > 0 && (
          <span className="text-muted-foreground text-sm">
            {topic
              ? `${items.length} in ${topic.label}`
              : total === 1
                ? "1 item"
                : `${total} items`}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {topic
            ? `Nothing in ${topic.label} needs practice right now.`
            : total === 0 && !practiced
              ? "No practice yet. Missed quiz questions and cards you rate Again appear here."
              : "Nothing needs practice right now."}
        </p>
      ) : (
        <ul className="divide-y">
          {shown.map((spot) => (
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
      )}
      {items.length > SHOWN && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
      {total > data.weak_spots.items.length && (
        <p className="text-muted-foreground text-xs">
          Listing the {data.weak_spots.items.length} most recent of {total}.
        </p>
      )}
    </section>
  );
}

function FromReflections({
  projectId,
  items,
  total,
}: {
  projectId: string;
  items: StudyUnclearItem[];
  total: number;
}) {
  const id = useId();
  const [deck, setDeck] = useState(NEW_DECK);
  const [added, setAdded] = useState<string[]>([]);
  const decks = useQuery({
    ...studyDeckGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page: 1, page_size: 100 },
    }),
    enabled: items.length > 0,
    retry: false,
  });
  return (
    <section aria-label="From your reflections" className="flex flex-col gap-2">
      <HelpHeading
        help="concept.reflection"
        className="text-sm font-medium"
        as="h3"
      >
        From your reflections
      </HelpHeading>
      {added.length > 0 && (
        <ul role="status" className="flex flex-col gap-1 text-sm">
          {added.map((front, index) => (
            <li key={index} className="flex items-start gap-2">
              <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 wrap-anywhere">Card added: {front}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No unclear items. What your reflections say is still unclear appears
          here, ready to become a flashcard.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Each item becomes a flashcard only when you add it. Reword the
            question if you like, and write the answer once you&apos;ve found
            it.
          </p>
          <Field>
            <FieldLabel htmlFor={`${id}-deck`}>Add cards to</FieldLabel>
            <Select value={deck} onValueChange={setDeck}>
              <SelectTrigger id={`${id}-deck`} className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_DECK}>Unclear items deck</SelectItem>
                {decks.data?.items
                  .filter((item) => item.name !== UNCLEAR_DECK_NAME)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <ol className="flex flex-col gap-3">
            {items.map((item) => (
              <UnclearItemForm
                key={`${item.reflection_id}:${item.text}`}
                item={item}
                label={`Unclear: ${item.text}`}
                projectId={projectId}
                deckId={deck === NEW_DECK ? null : deck}
                onAdded={(card) => setAdded((list) => [...list, card.front])}
              />
            ))}
          </ol>
          {total > items.length && (
            <p className="text-muted-foreground text-xs">
              Showing {items.length} of {total}; add or edit these to see more.
            </p>
          )}
        </>
      )}
    </section>
  );
}
