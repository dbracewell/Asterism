"use client";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import { studyDeckGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeckFormDialog } from "./deck-form-dialog";

const PAGE_SIZE = 20;

export function cardCountLabel(count: number) {
  return count === 1 ? "1 card" : `${count} cards`;
}

export function ProjectStudyDecks({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const decks = useQuery({
    ...studyDeckGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page, page_size: PAGE_SIZE },
    }),
    retry: false,
  });
  const newDeck = (
    <Button variant="outline" onClick={() => setCreating(true)}>
      New deck
    </Button>
  );
  return (
    <section className="flex flex-col gap-4" aria-label="Study decks">
      <div className="flex items-center justify-between">
        <h2 className="text-heading">Study decks</h2>
        {decks.data && decks.data.total > 0 && newDeck}
      </div>
      {decks.isPending && <ListSkeleton label="Loading decks" rows={3} />}
      {decks.error && (
        <QueryError
          error={decks.error}
          message={
            decks.data
              ? "Could not refresh decks. Showing saved results."
              : "Could not load decks."
          }
          retry={decks.refetch}
          isRetrying={decks.isFetching}
        />
      )}
      {decks.data &&
        (decks.data.total === 0 ? (
          <EmptyState
            title="No decks yet"
            description="Create a deck to collect flashcards from this project's material."
            action={newDeck}
          />
        ) : (
          <>
            <ul className="divide-y">
              {decks.data.items.map((deck) => (
                <li
                  key={deck.id}
                  className="flex items-baseline justify-between gap-3 py-3"
                >
                  <Link
                    href={`/projects/${projectId}/study/${deck.id}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {deck.name}
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {cardCountLabel(deck.card_count)}
                  </span>
                </li>
              ))}
            </ul>
            {decks.data.total > PAGE_SIZE && (
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={page === 1 || decks.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  Previous decks
                </Button>
                <span className="text-muted-foreground text-sm">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  disabled={
                    page * PAGE_SIZE >= decks.data.total || decks.isFetching
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Next decks
                </Button>
              </div>
            )}
          </>
        ))}
      <DeckFormDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSaved={(deck) =>
          router.push(`/projects/${projectId}/study/${deck.id}`)
        }
      />
    </section>
  );
}
