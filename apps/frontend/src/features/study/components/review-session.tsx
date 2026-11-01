"use client";

import { EmptyState } from "@/components/empty-state";
import { PageHeaderSkeleton } from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type {
  StudyReviewCard,
  StudyReviewPreview,
  StudyReviewQueue,
} from "@/lib/client";
import {
  studyCardGetManyQueryKey,
  studyCardReviewMutation,
  studyDeckGetManyQueryKey,
  studyDeckGetOneOptions,
  studyDeckGetOneQueryKey,
  studyProjectSummaryGetQueryKey,
  studyReviewQueueGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { studyErrorDetail } from "../lib/error-detail";
import { describeInterval, formatInterval } from "../lib/intervals";
import { CardCitations } from "./card-citations";

type StudyRating = keyof StudyReviewPreview;

/** Learning cards due within this window are shown now rather than ending the session. */
export const LEARN_AHEAD_SECONDS = 20 * 60;

export const RATINGS: { rating: StudyRating; label: string; key: string }[] = [
  { rating: "again", label: "Again", key: "1" },
  { rating: "hard", label: "Hard", key: "2" },
  { rating: "good", label: "Good", key: "3" },
  { rating: "easy", label: "Easy", key: "4" },
];

const nowSeconds = () => Math.floor(Date.now() / 1000);

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function ReviewSession({
  projectId,
  deckId,
}: {
  projectId: string;
  deckId: string;
}) {
  const path = { project_id: projectId, deck_id: deckId };
  const deck = useQuery({
    ...studyDeckGetOneOptions({ client, path }),
    retry: false,
  });
  const queue = useQuery({
    ...studyReviewQueueGetOptions({ client, path, query: { limit: 100 } }),
    retry: false,
    // The session owns its queue once loaded; a new visit loads a fresh one.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const deckHref = `/projects/${projectId}/study/${deckId}`;
  // Only an explicit "review more" starts a new session; background refetches never do.
  const [round, setRound] = useState(0);
  return (
    <PageLayout>
      <Link
        href={deckHref}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to deck
      </Link>
      {(deck.isPending || queue.isPending) && (
        <PageHeaderSkeleton label="Loading review" />
      )}
      {(deck.error || queue.error) && (
        <QueryError
          error={deck.error ?? queue.error}
          message="Could not load this review."
          retry={() => {
            void deck.refetch();
            void queue.refetch();
          }}
          isRetrying={deck.isFetching || queue.isFetching}
        />
      )}
      {deck.data && queue.data && (
        <>
          <PageHeader title={`Review ${deck.data.name}`} />
          <Session
            key={round}
            projectId={projectId}
            deckId={deckId}
            initial={queue.data}
            deckHref={deckHref}
            loadMore={async () => {
              const result = await queue.refetch();
              if (!result.error) setRound((value) => value + 1);
            }}
          />
        </>
      )}
    </PageLayout>
  );
}

function Session({
  projectId,
  deckId,
  initial,
  deckHref,
  loadMore,
}: {
  projectId: string;
  deckId: string;
  initial: StudyReviewQueue;
  deckHref: string;
  loadMore: () => Promise<void>;
}) {
  // Server times are compared against the server's clock; offset adjusts for drift.
  const [offset] = useState(() => initial.now - nowSeconds());
  // "Now" on the server's clock, refreshed whenever the session advances.
  const [now, setNow] = useState(initial.now);
  const [queue, setQueue] = useState(initial.items);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const showRef = useRef<HTMLButtonElement>(null);
  const goodRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const review = useMutation({
    ...studyCardReviewMutation({ client }),
    meta: {
      invalidates: [
        studyDeckGetOneQueryKey({
          client,
          path: { project_id: projectId, deck_id: deckId },
        }),
        studyDeckGetManyQueryKey({ client, path: { project_id: projectId } }),
        studyProjectSummaryGetQueryKey({
          client,
          path: { project_id: projectId },
        }),
        studyCardGetManyQueryKey({
          client,
          path: { project_id: projectId, deck_id: deckId },
        }),
      ],
    },
  });
  const current =
    queue[0] && queue[0].due_at <= now + LEARN_AHEAD_SECONDS ? queue[0] : null;

  function reveal() {
    if (!current || revealed) return;
    flushSync(() => {
      setRevealed(true);
      setAnnouncement("Answer shown. Rate how well you remembered it.");
    });
    goodRef.current?.focus();
  }

  function advance(next: StudyReviewCard[], message: string) {
    const moment = nowSeconds() + offset;
    const finished = !next[0] || next[0].due_at > moment + LEARN_AHEAD_SECONDS;
    flushSync(() => {
      setNow(moment);
      setQueue(next);
      setRevealed(false);
      setAnnouncement(finished ? `${message} Session complete.` : message);
    });
    (finished ? doneRef.current : showRef.current)?.focus();
  }

  async function rate(rating: StudyRating) {
    if (!current || !revealed || review.isPending) return;
    try {
      const updated = await review.mutateAsync({
        path: { project_id: projectId, deck_id: deckId, card_id: current.id },
        body: { rating, expected_reps: current.reps },
      });
      const rest = queue.slice(1);
      // Cards still in a short learning step come back later in this session.
      const next =
        updated.due_at <= nowSeconds() + offset + LEARN_AHEAD_SECONDS
          ? [...rest, updated].sort((a, b) => a.due_at - b.due_at)
          : rest;
      setReviewed((count) => count + 1);
      advance(
        next,
        `Rated ${rating}. Next review ${describeInterval(updated.due_at - (nowSeconds() + offset))}.`,
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 409
      ) {
        toast.info("This card was already reviewed. Moving to the next card.");
        advance(
          queue.slice(1),
          "Card already reviewed. Showing the next card.",
        );
      } else {
        toast.error(
          studyErrorDetail(error, "Could not save your rating. Try again."),
        );
      }
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey)
        return;
      if (isTyping(event.target)) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        // Let a focused button handle its own activation.
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        reveal();
        return;
      }
      const choice = RATINGS.find((item) => item.key === event.key);
      if (revealed && choice) {
        event.preventDefault();
        void rate(choice.rating);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!current) {
    const later = queue.length;
    const more = initial.due_count > initial.items.length;
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="region"
        aria-label="Review summary"
        className="outline-none"
      >
        <EmptyState
          title={reviewed > 0 ? "Session complete" : "No cards are due"}
          description={
            reviewed > 0
              ? `You reviewed ${reviewed === 1 ? "1 card" : `${reviewed} cards`}.${later ? ` ${later === 1 ? "1 card returns" : `${later} cards return`} later.` : ""}`
              : "Every card in this deck is scheduled for later. Come back when cards are due."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {more && reviewed > 0 && (
                <Button onClick={() => void loadMore()}>
                  Review more due cards
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href={deckHref}>Back to deck</Link>
              </Button>
            </div>
          }
        />
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Review session" className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {queue.length === 1 ? "1 card left" : `${queue.length} cards left`}
        {reviewed > 0 && ` · ${reviewed} reviewed`}
      </p>
      <article
        aria-label="Card"
        className="rounded-surface flex min-h-48 flex-col gap-4 border p-6"
      >
        <div>
          <h2 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
            Front
          </h2>
          {/* Card text is untrusted. */}
          <MarkdownViewer content={current.front} />
        </div>
        {revealed && (
          <div className="border-t pt-4">
            <h2 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
              Back
            </h2>
            <MarkdownViewer content={current.back} />
          </div>
        )}
        {revealed && current.citations.length > 0 && (
          <CardCitations citations={current.citations} />
        )}
      </article>
      {revealed ? (
        <div
          role="group"
          aria-label="Rate your recall"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {RATINGS.map(({ rating, label, key }) => {
            const wait = current.previews[rating] - now;
            return (
              <Button
                key={rating}
                ref={rating === "good" ? goodRef : undefined}
                variant={
                  rating === "again"
                    ? "outline"
                    : rating === "good"
                      ? "default"
                      : "secondary"
                }
                className="h-auto flex-col gap-0.5 py-2"
                disabled={review.isPending}
                aria-keyshortcuts={key}
                onClick={() => void rate(rating)}
              >
                <span>{label}</span>
                <span className="text-xs">
                  {formatInterval(wait)} · key {key}
                </span>
                <span className="sr-only">
                  , next review {describeInterval(wait)}
                </span>
              </Button>
            );
          })}
        </div>
      ) : (
        <div>
          <Button
            ref={showRef}
            aria-keyshortcuts="Space Enter"
            onClick={reveal}
            autoFocus
          >
            Show answer
          </Button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Keyboard: Space or Enter shows the answer; 1 Again, 2 Hard, 3 Good, 4
        Easy.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
