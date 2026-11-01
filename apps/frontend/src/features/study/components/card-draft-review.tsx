"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { PageHeaderSkeleton } from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { ModelSelector } from "@/components/settings/model-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/features/auth/components/user-context";
import { client } from "@/lib/api";
import type {
  StudyCardDraft,
  StudyCardDraftBatch,
  StudyCitation,
} from "@/lib/client";
import {
  chatModelsListOptions,
  projectFileGetManyOptions,
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

export const MAX_DRAFT_CARDS = 30;
export const MAX_DRAFT_FILES = 10;

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
        <p role="status" className="flex items-center gap-2 text-sm">
          <Spinner /> Drafting cards. This can take a minute or two.
        </p>
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
  const user = useUser();
  const [scope, setScope] = useState<"all" | "choose">("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const [count, setCount] = useState("10");
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const models = useQuery({
    ...chatModelsListOptions({ client }),
    retry: false,
  });
  const files = useQuery({
    ...projectFileGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page: 1, page_size: 100, sort_by: "name" },
    }),
    retry: false,
  });
  const availableModels = (models.data ?? []).filter(
    (model) => model.available,
  );
  const fallbackModel =
    availableModels.find((model) => model.id === user.settings.default_model_id)
      ?.id ?? availableModels[0]?.id;
  const model = availableModels.some((item) => item.id === modelId)
    ? modelId
    : fallbackModel;
  const cards = Number(count);
  const validCount =
    Number.isInteger(cards) && cards >= 1 && cards <= MAX_DRAFT_CARDS;
  const projectFiles = files.data?.files ?? [];
  const valid =
    !!model &&
    validCount &&
    (scope === "all"
      ? projectFiles.length > 0 && projectFiles.length <= MAX_DRAFT_FILES
      : chosen.length > 0);
  return (
    <form
      className="rounded-surface flex flex-col gap-5 border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !model) return;
        onSubmit({
          model_id: model,
          count: cards,
          file_ids: scope === "all" ? null : chosen,
        });
      }}
    >
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Source files</FieldLegend>
          <RadioGroup
            value={scope}
            onValueChange={(value) => setScope(value as "all" | "choose")}
            disabled={pending}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="all" id="draft-scope-all" />
              <Label htmlFor="draft-scope-all">
                All project files (up to {MAX_DRAFT_FILES})
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="choose" id="draft-scope-choose" />
              <Label htmlFor="draft-scope-choose">Choose files</Label>
            </div>
          </RadioGroup>
          {files.error && (
            <QueryError
              error={files.error}
              message="Could not load project files."
              retry={files.refetch}
              isRetrying={files.isFetching}
            />
          )}
          {files.data && projectFiles.length === 0 && (
            <FieldDescription>
              This project has no files yet. Add files on the project page
              first.
            </FieldDescription>
          )}
          {scope === "all" && projectFiles.length > MAX_DRAFT_FILES && (
            <FieldDescription>
              This project has more than {MAX_DRAFT_FILES} files. Choose the
              files to draft from.
            </FieldDescription>
          )}
          {scope === "choose" && projectFiles.length > 0 && (
            <ul
              aria-label="Project files"
              className="flex max-h-64 flex-col gap-2 overflow-y-auto"
            >
              {projectFiles.map((file) => {
                const checked = chosen.includes(file.id);
                const id = `draft-file-${file.id}`;
                return (
                  <li key={file.id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={checked}
                      disabled={
                        pending ||
                        (!checked && chosen.length >= MAX_DRAFT_FILES)
                      }
                      onCheckedChange={(next) =>
                        setChosen(
                          next
                            ? [...chosen, file.id]
                            : chosen.filter((item) => item !== file.id),
                        )
                      }
                    />
                    <Label htmlFor={id} className="min-w-0 truncate">
                      {file.filename}
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
          {scope === "choose" && (
            <FieldDescription>
              {chosen.length} of up to {MAX_DRAFT_FILES} files chosen.
            </FieldDescription>
          )}
        </FieldSet>
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
        <Field>
          <FieldLabel htmlFor="draft-model">Model</FieldLabel>
          <ModelSelector
            id="draft-model"
            value={model}
            onValueChange={setModelId}
            availableModels={availableModels}
            disabled={pending || models.isPending || !!models.error}
          />
          {models.error && (
            <QueryError
              error={models.error}
              message="Could not load models."
              retry={models.refetch}
              isRetrying={models.isFetching}
            />
          )}
          {models.data && availableModels.length === 0 && (
            <FieldDescription>
              No models are available. Ask an administrator to enable one.
            </FieldDescription>
          )}
        </Field>
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
