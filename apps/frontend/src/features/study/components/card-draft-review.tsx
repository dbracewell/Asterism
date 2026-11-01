"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { PageHeaderSkeleton } from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type {
  StudyCardDraft,
  StudyCardDraftBatch,
  StudyCitation,
} from "@/lib/client";
import {
  studyCardCreateMutation,
  studyCardDraftGenerateMutation,
  studyDeckGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";
import { CardCitations } from "./card-citations";
import { CARD_SIDE_MAX } from "./card-form-dialog";
import {
  MAX_SOURCE_FILES,
  SourceFilesFieldset,
  StudyModelField,
  useSourceFiles,
  useStudyModel,
} from "./source-fields";
import { PendingStatus } from "./pending-status";

export const MAX_DRAFT_CARDS = 30;
export const MAX_DRAFT_FILES = MAX_SOURCE_FILES;

type DraftStatus = "pending" | "saving" | "saved" | "discarded";

export type ReviewDraft = StudyCardDraft & {
  key: number;
  status: DraftStatus;
  error?: string;
};

/** Citations as the card create route accepts them (live fields are server-derived). */
export function citationInputs(citations: StudyCitation[]) {
  return citations.map(
    ({ file_id, chunk_id, artifact_generation, excerpt }) => ({
      file_id,
      chunk_id,
      artifact_generation,
      excerpt,
    }),
  );
}

export function CardDraftReview({
  projectId,
  deckId,
}: {
  projectId: string;
  deckId: string;
}) {
  const deck = useQuery({
    ...studyDeckGetOneOptions({
      client,
      path: { project_id: projectId, deck_id: deckId },
    }),
    retry: false,
  });
  const deckHref = `/projects/${projectId}/study/${deckId}`;
  return (
    <PageLayout>
      <Link
        href={deckHref}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to deck
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
            title="Draft cards"
            description={`Draft flashcards for ${deck.data.name} from this project's files. Drafts are not saved until you accept them.`}
          />
          <DraftWorkspace projectId={projectId} deckId={deckId} />
        </>
      )}
    </PageLayout>
  );
}

function DraftWorkspace({
  projectId,
  deckId,
}: {
  projectId: string;
  deckId: string;
}) {
  const [batch, setBatch] = useState<StudyCardDraftBatch | null>(null);
  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const generate = useMutation({
    ...studyCardDraftGenerateMutation({ client }),
    // Drafting changes nothing on the server.
    meta: { skipGlobalInvalidation: true },
    onSuccess: (result) => {
      setBatch(result);
      setDrafts(
        result.drafts.map((draft, key) => ({
          ...draft,
          key,
          status: "pending",
        })),
      );
    },
  });
  const create = useMutation(studyCardCreateMutation({ client }));
  const { confirm, dialog } = useConfirmationDialog({
    title: "Replace your drafts?",
    description:
      "Drafts you have not accepted will be discarded. Accepted cards stay in the deck.",
    confirmText: "Draft again",
  });
  const pending = drafts.filter((draft) => draft.status === "pending");

  function patch(key: number, changes: Partial<ReviewDraft>) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? { ...draft, ...changes } : draft,
      ),
    );
  }

  async function accept(draft: ReviewDraft) {
    patch(draft.key, { status: "saving", error: undefined });
    try {
      await create.mutateAsync({
        path: { project_id: projectId, deck_id: deckId },
        body: {
          front: draft.front,
          back: draft.back,
          citations: citationInputs(draft.citations),
        },
      });
      patch(draft.key, { status: "saved" });
    } catch (error) {
      patch(draft.key, {
        status: "pending",
        error: studyErrorDetail(error, "Could not save this card. Try again."),
      });
    }
  }

  return (
    <>
      <DraftForm
        projectId={projectId}
        pending={generate.isPending}
        onSubmit={async (body) => {
          if (pending.length > 0 && !(await confirm())) return;
          generate.mutate({
            path: { project_id: projectId, deck_id: deckId },
            body,
          });
        }}
      />
      {generate.isPending && (
        <PendingStatus>
          Drafting cards. This can take a minute or two.
        </PendingStatus>
      )}
      {generate.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(
            generate.error,
            "Could not draft cards. Try again.",
          )}
        </p>
      )}
      {batch && !generate.isPending && (
        <>
          <FileResults batch={batch} />
          <section aria-label="Drafts" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-heading">Drafts</h2>
              {pending.length > 1 && (
                <Button
                  onClick={async () => {
                    for (const draft of pending) await accept(draft);
                  }}
                >
                  Accept all ({pending.length})
                </Button>
              )}
            </div>
            {drafts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No drafts were produced. Check the file results above and try
                again.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {drafts.map((draft, index) => (
                  <DraftItem
                    key={draft.key}
                    number={index + 1}
                    draft={draft}
                    onAccept={() => accept(draft)}
                    onChange={(changes) => patch(draft.key, changes)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {dialog}
    </>
  );
}

function DraftForm({
  projectId,
  pending,
  onSubmit,
}: {
  projectId: string;
  pending: boolean;
  onSubmit: (body: {
    model_id: string;
    count: number;
    file_ids: string[] | null;
  }) => void;
}) {
  const [count, setCount] = useState("10");
  const source = useSourceFiles(projectId);
  const choice = useStudyModel();
  const { model } = choice;
  const cards = Number(count);
  const validCount =
    Number.isInteger(cards) && cards >= 1 && cards <= MAX_DRAFT_CARDS;
  const valid = !!model && validCount && source.valid;
  return (
    <form
      className="rounded-surface flex flex-col gap-5 border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !model) return;
        onSubmit({ model_id: model, count: cards, file_ids: source.fileIds });
      }}
    >
      <FieldGroup>
        <SourceFilesFieldset
          idPrefix="draft"
          disabled={pending}
          source={source}
        />
        <Field>
          <FieldLabel htmlFor="draft-count">Number of cards</FieldLabel>
          <Input
            id="draft-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DRAFT_CARDS}
            className="w-28"
            value={count}
            disabled={pending}
            aria-invalid={!validCount}
            onChange={(event) => setCount(event.target.value)}
          />
          <FieldDescription>
            From 1 to {MAX_DRAFT_CARDS}, spread across the files.
          </FieldDescription>
        </Field>
        <StudyModelField id="draft-model" disabled={pending} choice={choice} />
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Drafting…" : "Draft cards"}
        </Button>
      </div>
    </form>
  );
}

function FileResults({ batch }: { batch: StudyCardDraftBatch }) {
  return (
    <section aria-label="File results" className="flex flex-col gap-2">
      <h2 className="text-heading">Files</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {batch.files.map((file) => (
          <li
            key={file.file_id}
            className="flex flex-wrap items-baseline gap-2"
          >
            <span className="font-medium">
              {file.file_name ?? "Unavailable file"}
            </span>
            {file.status === "used" ? (
              <span className="text-muted-foreground">
                {file.card_count === 1
                  ? "1 draft"
                  : `${file.card_count} drafts`}
                {file.truncated && ". Only the start of this file was used."}
              </span>
            ) : (
              <span className="text-destructive">{file.message}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DraftItem({
  number,
  draft,
  onAccept,
  onChange,
}: {
  number: number;
  draft: ReviewDraft;
  onAccept: () => void;
  onChange: (changes: Partial<ReviewDraft>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(draft.front);
  const [back, setBack] = useState(draft.back);
  const label = `Draft ${number}`;
  if (draft.status === "discarded")
    return (
      <li className="text-muted-foreground rounded-surface flex items-center justify-between gap-2 border border-dashed p-3 text-sm">
        <span>{label} discarded.</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Restore ${label}`}
          onClick={() => onChange({ status: "pending" })}
        >
          Undo
        </Button>
      </li>
    );
  const saved = draft.status === "saved";
  const saving = draft.status === "saving";
  const validEdit = front.trim() !== "" && back.trim() !== "";
  return (
    <li
      aria-label={label}
      className="rounded-surface flex flex-col gap-3 border p-4"
    >
      {editing ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`draft-${draft.key}-front`}>Front</FieldLabel>
            <Textarea
              id={`draft-${draft.key}-front`}
              maxLength={CARD_SIDE_MAX}
              value={front}
              onChange={(event) => setFront(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`draft-${draft.key}-back`}>Back</FieldLabel>
            <Textarea
              id={`draft-${draft.key}-back`}
              maxLength={CARD_SIDE_MAX}
              value={back}
              onChange={(event) => setBack(event.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              Front
            </h3>
            {/* Generated text is untrusted. */}
            <MarkdownViewer content={draft.front} className="text-sm" />
          </div>
          <div className="min-w-0">
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              Back
            </h3>
            <MarkdownViewer content={draft.back} className="text-sm" />
          </div>
        </div>
      )}
      <CardCitations citations={draft.citations} />
      {draft.error && (
        <p role="alert" className="text-destructive text-sm">
          {draft.error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved ? (
          <Badge variant="secondary">Saved to deck</Badge>
        ) : editing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFront(draft.front);
                setBack(draft.back);
                setEditing(false);
              }}
            >
              Cancel edit
            </Button>
            <Button
              size="sm"
              disabled={!validEdit}
              onClick={() => {
                onChange({ front: front.trim(), back: back.trim() });
                setEditing(false);
              }}
            >
              Done editing
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Discard ${label}`}
              disabled={saving}
              onClick={() =>
                onChange({ status: "discarded", error: undefined })
              }
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Edit ${label}`}
              disabled={saving}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              aria-label={`Accept ${label}`}
              disabled={saving}
              onClick={onAccept}
            >
              {saving ? "Saving…" : "Accept"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
