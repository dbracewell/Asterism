"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { Rubric, RubricDocument } from "@/lib/client";
import {
  rubricCreateMutation,
  rubricDeleteMutation,
  rubricGetOneQueryKey,
  rubricUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { duplicateName } from "../lib/draft";
import {
  addLevel,
  blankRubricDraft,
  hasRubricIssues,
  moveCriterion,
  moveLevel,
  newCriterion,
  removeLevel,
  RUBRIC_LIMITS,
  rubricBytes,
  rubricFromDocument,
  rubricSignature,
  rubricToDocument,
  validateRubric,
  type RubricCriterionDraft,
  type RubricDraft,
} from "../lib/rubric-draft";
import {
  bundledRubricsOptions,
  rubricDetailOptions,
  rubricMutationInvalidates,
} from "../queries";

export type RubricEditorTarget =
  | { type: "new" }
  | { type: "edit"; id: string }
  | { type: "duplicate"; source: "bundled" | "owned"; id: string };

type Props = {
  owner: string;
  target: RubricEditorTarget;
  onClose: (deleted?: boolean) => void;
  restoreFocus: () => void;
};

function errorDetail(error: unknown) {
  if (error && typeof error === "object" && "detail" in error) {
    const { detail } = error;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string")
      return `Invalid rubric: ${detail[0].msg}`;
  }
  return "Retry, or reload the page if it keeps failing.";
}

export function RubricEditorDialog(props: Props) {
  const { owner, target } = props;
  const detailId =
    target.type === "edit" ||
    (target.type === "duplicate" && target.source === "owned")
      ? target.id
      : null;
  const detail = useQuery(rubricDetailOptions(owner, detailId));
  const bundled = useQuery({
    ...bundledRubricsOptions(),
    enabled: target.type === "duplicate" && target.source === "bundled",
  });
  if (target.type === "new")
    return <LoadedRubricEditor {...props} initial={null} start={null} />;
  const query = detailId === null ? bundled : detail;
  const source: RubricDocument | undefined =
    detailId === null
      ? bundled.data?.items.find((item) => item.id === target.id)?.document
      : detail.data?.document;
  if (!source)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            props.restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rubric</DialogTitle>
            <DialogDescription>
              Load the current rubric before editing.
            </DialogDescription>
          </DialogHeader>
          {query.isPending ? (
            <FormSkeleton label="Loading rubric…" fields={3} />
          ) : (
            <QueryError
              error={query.error ?? new Error("Rubric not found")}
              message="Could not load this rubric."
              retry={query.refetch}
              isRetrying={query.isFetching}
            />
          )}
        </DialogContent>
      </Dialog>
    );
  if (target.type === "duplicate")
    return (
      <LoadedRubricEditor
        {...props}
        initial={null}
        start={{ ...source, name: duplicateName(source.name) }}
      />
    );
  return (
    <LoadedRubricEditor
      {...props}
      initial={detail.data ?? null}
      reload={async () => {
        const result = await detail.refetch();
        return result.error ? undefined : result.data;
      }}
      start={null}
    />
  );
}

function LoadedRubricEditor({
  initial,
  start,
  reload,
  onClose,
  restoreFocus,
}: Props & {
  /** The saved rubric being edited, or `null` when creating. */
  initial: Rubric | null;
  /** The document a new rubric starts from (duplicates); a template if `null`. */
  start: RubricDocument | null;
  reload?: () => Promise<Rubric | undefined>;
}) {
  const idPrefix = useId();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState<RubricDraft>(() =>
    initial
      ? rubricFromDocument(initial.document)
      : start
        ? rubricFromDocument(start)
        : blankRubricDraft(),
  );
  const [pristine, setPristine] = useState(() => rubricSignature(draft));
  const [showIssues, setShowIssues] = useState(false);
  const [reloading, setReloading] = useState(false);
  const issuesRef = useRef<HTMLDivElement>(null);

  const create = useMutation({
    ...rubricCreateMutation({ client }),
    meta: { invalidates: rubricMutationInvalidates() },
  });
  const update = useMutation({
    ...rubricUpdateMutation({ client }),
    meta: {
      invalidates: [
        ...rubricMutationInvalidates(),
        ...(baseline
          ? [rubricGetOneQueryKey({ path: { rubric_id: baseline.id } })]
          : []),
      ],
    },
  });
  const remove = useMutation({
    ...rubricDeleteMutation({ client }),
    meta: { invalidates: rubricMutationInvalidates() },
  });
  const pending =
    create.isPending || update.isPending || remove.isPending || reloading;
  const dirty = rubricSignature(draft) !== pristine;
  const issues = validateRubric(draft);
  const invalid = hasRubricIssues(issues);
  const error = create.error ?? update.error ?? remove.error;

  const discard = useConfirmationDialog({
    title: "Discard unsaved rubric changes?",
    description: "Your unsaved changes will be lost.",
    confirmText: "Discard changes",
    confirmVariant: "destructive",
  });
  const deletion = useConfirmationDialog({
    title: `Delete ${baseline?.name ?? "rubric"}?`,
    description:
      "This deletes the rubric. Messages assessed against it keep their copy, shown as unavailable.",
    confirmText: "Delete rubric",
    confirmVariant: "destructive",
  });
  const close = async () => {
    if (!pending && (!dirty || (await discard.confirm()))) onClose();
  };
  const reloadCurrent = async () => {
    if (!reload || (dirty && !(await discard.confirm()))) return;
    setReloading(true);
    try {
      const current = await reload();
      if (current) {
        const next = rubricFromDocument(current.document);
        setBaseline(current);
        setDraft(next);
        setPristine(rubricSignature(next));
        update.reset();
        remove.reset();
      }
    } finally {
      setReloading(false);
    }
  };
  const focusLater = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  const setCriterion = (uid: string, next: Partial<RubricCriterionDraft>) =>
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) =>
        criterion.uid === uid ? { ...criterion, ...next } : criterion,
      ),
    }));

  const save = async () => {
    if (pending) return;
    if (invalid) {
      setShowIssues(true);
      requestAnimationFrame(() => issuesRef.current?.focus());
      return;
    }
    const document = rubricToDocument(draft);
    try {
      if (baseline)
        await update.mutateAsync({
          path: { rubric_id: baseline.id },
          body: { document, expected_revision: baseline.revision },
        });
      else await create.mutateAsync({ body: { document } });
      toast.success(baseline ? "Rubric saved" : "Rubric created");
      onClose();
    } catch {
      /* Mutation errors stay visible with the draft. */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">
            {baseline ? `Edit ${baseline.name}` : "Create rubric"}
          </DialogTitle>
          <DialogDescription>
            Define the performance levels and what each criterion looks like at
            every level. Draft feedback assesses writing against it; rubric text
            grants no tools, files or other permissions.
          </DialogDescription>
        </DialogHeader>
        {discard.dialog}
        {deletion.dialog}
        <form
          noValidate
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          onKeyDown={(event) => {
            // Enter in a single-line input should not save the whole rubric.
            if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement
            )
              event.preventDefault();
          }}
        >
          {showIssues && invalid && (
            <div
              ref={issuesRef}
              tabIndex={-1}
              role="alert"
              className="rounded-surface border-destructive/50 text-destructive border p-3 outline-none"
            >
              <p className="font-medium">Fix these before saving:</p>
              <ul className="list-disc pl-4">
                {issues.general.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
                {draft.criteria.flatMap((criterion, index) =>
                  (issues.criteria[criterion.uid] ?? []).map((issue) => (
                    <li key={`${criterion.uid}:${issue}`}>
                      Criterion {index + 1}
                      {criterion.label.trim() && ` (${criterion.label.trim()})`}
                      : {issue}
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
            <Input
              id={`${idPrefix}-name`}
              value={draft.name}
              maxLength={RUBRIC_LIMITS.name}
              disabled={pending}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-description`}>
              Description
            </FieldLabel>
            <Textarea
              id={`${idPrefix}-description`}
              value={draft.description}
              maxLength={RUBRIC_LIMITS.description}
              className="min-h-16"
              disabled={pending}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </Field>
          <section
            aria-labelledby={`${idPrefix}-levels`}
            className="flex min-w-0 flex-col gap-2"
          >
            <h3 id={`${idPrefix}-levels`} className="font-medium">
              Levels
            </h3>
            <p className="text-muted-foreground text-sm">
              From the highest to the lowest, {RUBRIC_LIMITS.minLevels}–
              {RUBRIC_LIMITS.levels} levels.
            </p>
            <ol className="flex min-w-0 flex-col gap-2">
              {draft.levels.map((level, index) => (
                <li key={level.uid} className="flex min-w-0 items-center gap-1">
                  <Input
                    id={`${idPrefix}-level-${level.uid}`}
                    aria-label={`Level ${index + 1} name`}
                    value={level.label}
                    maxLength={RUBRIC_LIMITS.levelLabel}
                    disabled={pending}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        levels: draft.levels.map((item) =>
                          item.uid === level.uid
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move level ${index + 1} up`}
                    disabled={pending || index === 0}
                    onClick={() => setDraft(moveLevel(draft, index, -1))}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move level ${index + 1} down`}
                    disabled={pending || index === draft.levels.length - 1}
                    onClick={() => setDraft(moveLevel(draft, index, 1))}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove level ${index + 1}`}
                    disabled={
                      pending || draft.levels.length <= RUBRIC_LIMITS.minLevels
                    }
                    onClick={() => setDraft(removeLevel(draft, index))}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={pending || draft.levels.length >= RUBRIC_LIMITS.levels}
              onClick={() => {
                const next = addLevel(draft);
                setDraft(next);
                focusLater(`${idPrefix}-level-${next.levels.at(-1)!.uid}`);
              }}
            >
              <PlusIcon />
              Add level
            </Button>
          </section>
          <section
            aria-labelledby={`${idPrefix}-criteria`}
            className="flex min-w-0 flex-col gap-3"
          >
            <h3 id={`${idPrefix}-criteria`} className="font-medium">
              Criteria
            </h3>
            {draft.criteria.map((criterion, index) => (
              <fieldset
                key={criterion.uid}
                aria-label={`Criterion ${index + 1}`}
                className="rounded-surface border-border flex min-w-0 flex-col gap-3 border p-3"
                aria-invalid={
                  showIssues && !!issues.criteria[criterion.uid]?.length
                }
              >
                <div className="flex min-w-0 items-end gap-1">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel htmlFor={`${idPrefix}-${criterion.uid}-label`}>
                      Criterion {index + 1} name
                    </FieldLabel>
                    <Input
                      id={`${idPrefix}-${criterion.uid}-label`}
                      value={criterion.label}
                      maxLength={RUBRIC_LIMITS.criterionLabel}
                      disabled={pending}
                      onChange={(event) =>
                        setCriterion(criterion.uid, {
                          label: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move criterion ${index + 1} up`}
                    disabled={pending || index === 0}
                    onClick={() => setDraft(moveCriterion(draft, index, -1))}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move criterion ${index + 1} down`}
                    disabled={pending || index === draft.criteria.length - 1}
                    onClick={() => setDraft(moveCriterion(draft, index, 1))}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove criterion ${index + 1}`}
                    disabled={pending || draft.criteria.length <= 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        criteria: draft.criteria.filter(
                          (item) => item.uid !== criterion.uid,
                        ),
                      })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <Field>
                  <FieldLabel
                    htmlFor={`${idPrefix}-${criterion.uid}-description`}
                  >
                    What it assesses (optional)
                  </FieldLabel>
                  <Input
                    id={`${idPrefix}-${criterion.uid}-description`}
                    value={criterion.description}
                    maxLength={RUBRIC_LIMITS.criterionDescription}
                    disabled={pending}
                    onChange={(event) =>
                      setCriterion(criterion.uid, {
                        description: event.target.value,
                      })
                    }
                  />
                </Field>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {draft.levels.map((level, position) => (
                    <Field key={level.uid}>
                      <FieldLabel
                        htmlFor={`${idPrefix}-${criterion.uid}-${level.uid}`}
                      >
                        {level.label.trim() || `Level ${position + 1}`}
                      </FieldLabel>
                      <Textarea
                        id={`${idPrefix}-${criterion.uid}-${level.uid}`}
                        value={criterion.descriptors[position] ?? ""}
                        maxLength={RUBRIC_LIMITS.descriptor}
                        className="min-h-16"
                        disabled={pending}
                        onChange={(event) =>
                          setCriterion(criterion.uid, {
                            descriptors: criterion.descriptors.map(
                              (text, item) =>
                                item === position ? event.target.value : text,
                            ),
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={
                pending || draft.criteria.length >= RUBRIC_LIMITS.criteria
              }
              onClick={() => {
                const criterion = newCriterion(draft.levels.length);
                setDraft({
                  ...draft,
                  criteria: [...draft.criteria, criterion],
                });
                focusLater(`${idPrefix}-${criterion.uid}-label`);
              }}
            >
              <PlusIcon />
              Add criterion
            </Button>
            <FieldDescription>
              {rubricBytes(draft).toLocaleString()} /{" "}
              {RUBRIC_LIMITS.documentBytes.toLocaleString()} UTF-8 bytes.
            </FieldDescription>
          </section>
          {error && (
            <EmptyState
              role="alert"
              className="flex-none items-start p-3 text-left"
              title="Could not save or delete rubric"
              description={errorDetail(error)}
            />
          )}
          <footer className="flex flex-wrap items-center justify-end gap-2">
            {baseline && (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={async () => {
                    if (!(await deletion.confirm())) return;
                    try {
                      await remove.mutateAsync({
                        path: { rubric_id: baseline.id },
                        query: { expected_revision: baseline.revision },
                      });
                      toast.success("Rubric deleted");
                      onClose(true);
                    } catch {
                      /* Keep the draft and revision on failure. */
                    }
                  }}
                >
                  Delete rubric
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void reloadCurrent()}
                >
                  Reload current rubric
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void close()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save rubric"}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
