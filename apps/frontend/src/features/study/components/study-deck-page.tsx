"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { EmptyState } from "@/components/empty-state";
import {
  ListSkeleton,
  PageHeaderSkeleton,
} from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type { StudyCard, StudyCitation } from "@/lib/client";
import {
  studyCardDeleteMutation,
  studyCardGetManyOptions,
  studyDeckDeleteMutation,
  studyDeckGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { studyErrorDetail } from "../lib/error-detail";
import { CardFormDialog } from "./card-form-dialog";
import { DeckFormDialog } from "./deck-form-dialog";
import { cardCountLabel } from "./project-study-decks";

const PAGE_SIZE = 25;

export function StudyDeckPage({
  projectId,
  deckId,
}: {
  projectId: string;
  deckId: string;
}) {
  const router = useRouter();
  const path = { project_id: projectId, deck_id: deckId };
  const deck = useQuery({
    ...studyDeckGetOneOptions({ client, path }),
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    ...studyDeckDeleteMutation({ client }),
    onSuccess: () => router.push(`/projects/${projectId}`),
  });
  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${deck.data?.name ?? "deck"}?`,
    description:
      "The deck and all of its cards will be deleted. Project files are not affected.",
    confirmVariant: "destructive",
    confirmText: "Delete deck",
  });
  return (
    <PageLayout>
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to project
      </Link>
      {deck.isPending && <PageHeaderSkeleton label="Loading deck" />}
      {deck.error && (
        <QueryError
          error={deck.error}
          message="Could not load this deck."
          retry={deck.refetch}
          isRetrying={deck.isFetching}
        />
      )}
      {deck.data && (
        <>
          <PageHeader
            title={deck.data.name}
            description={
              deck.data.description || cardCountLabel(deck.data.card_count)
            }
            actions={
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit deck
                </Button>
                <Button
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (await confirm()) remove.mutate({ path });
                  }}
                >
                  {remove.isPending ? "Deleting…" : "Delete deck"}
                </Button>
              </>
            }
          />
          {remove.error && (
            <p role="alert" className="text-destructive text-sm">
              {studyErrorDetail(remove.error, "Could not delete the deck.")}
            </p>
          )}
          <DeckCards projectId={projectId} deckId={deckId} />
          <DeckFormDialog
            projectId={projectId}
            deck={deck.data}
            open={editing}
            onOpenChange={setEditing}
          />
        </>
      )}
      {dialog}
    </PageLayout>
  );
}

function DeckCards({
  projectId,
  deckId,
}: {
  projectId: string;
  deckId: string;
}) {
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<
    { type: "new" } | { type: "edit"; card: StudyCard } | null
  >(null);
  const cards = useQuery({
    ...studyCardGetManyOptions({
      client,
      path: { project_id: projectId, deck_id: deckId },
      query: { page, page_size: PAGE_SIZE },
    }),
    retry: false,
  });
  const addCard = (
    <Button onClick={() => setEditor({ type: "new" })}>Add card</Button>
  );
  return (
    <section className="flex flex-col gap-4" aria-label="Cards">
      <div className="flex items-center justify-between">
        <h2 className="text-heading">Cards</h2>
        {cards.data && cards.data.total > 0 && addCard}
      </div>
      {cards.isPending && <ListSkeleton label="Loading cards" rows={4} />}
      {cards.error && (
        <QueryError
          error={cards.error}
          message={
            cards.data
              ? "Could not refresh cards. Showing saved results."
              : "Could not load cards."
          }
          retry={cards.refetch}
          isRetrying={cards.isFetching}
        />
      )}
      {cards.data &&
        (cards.data.total === 0 ? (
          <EmptyState
            title="No cards yet"
            description="Add a card with a question on the front and the answer on the back."
            action={addCard}
          />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {cards.data.items.map((card) => (
                <CardItem
                  key={card.id}
                  projectId={projectId}
                  deckId={deckId}
                  card={card}
                  onEdit={() => setEditor({ type: "edit", card })}
                />
              ))}
            </ul>
            {cards.data.total > PAGE_SIZE && (
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={page === 1 || cards.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  Previous cards
                </Button>
                <span className="text-muted-foreground text-sm">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  disabled={
                    page * PAGE_SIZE >= cards.data.total || cards.isFetching
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Next cards
                </Button>
              </div>
            )}
          </>
        ))}
      <CardFormDialog
        // Remount per target so the form starts from the chosen card.
        key={editor?.type === "edit" ? editor.card.id : "new"}
        projectId={projectId}
        deckId={deckId}
        card={editor?.type === "edit" ? editor.card : undefined}
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      />
    </section>
  );
}

function CardItem({
  projectId,
  deckId,
  card,
  onEdit,
}: {
  projectId: string;
  deckId: string;
  card: StudyCard;
  onEdit: () => void;
}) {
  const remove = useMutation({
    ...studyCardDeleteMutation({ client }),
    onError: (error) =>
      toast.error(studyErrorDetail(error, "Could not delete the card.")),
  });
  const label =
    card.front.length > 60 ? `${card.front.slice(0, 60)}…` : card.front;
  const { confirm, dialog } = useConfirmationDialog({
    title: "Delete this card?",
    description: "The card will be removed from the deck.",
    confirmVariant: "destructive",
    confirmText: "Delete card",
  });
  return (
    <li className="rounded-surface flex flex-col gap-3 border p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Front
          </h3>
          {/* Card text may come from generated drafts; it is untrusted. */}
          <MarkdownViewer content={card.front} className="text-sm" />
        </div>
        <div className="min-w-0">
          <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Back
          </h3>
          <MarkdownViewer content={card.back} className="text-sm" />
        </div>
      </div>
      {card.citations.length > 0 && (
        <CardCitations citations={card.citations} />
      )}
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Edit card: ${label}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Delete card: ${label}`}
          disabled={remove.isPending}
          onClick={async () => {
            if (await confirm())
              remove.mutate({
                path: {
                  project_id: projectId,
                  deck_id: deckId,
                  card_id: card.id,
                },
              });
          }}
        >
          Delete
        </Button>
      </div>
      {dialog}
    </li>
  );
}

export function CardCitations({ citations }: { citations: StudyCitation[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sources:</span>
      {citations.map((citation, index) => (
        <Badge
          key={`${citation.file_id}-${citation.chunk_id ?? index}`}
          variant={citation.available ? "secondary" : "outline"}
          title={citation.excerpt ?? undefined}
        >
          {citation.available
            ? citation.file_name
            : "Source no longer in this project"}
        </Badge>
      ))}
    </div>
  );
}
