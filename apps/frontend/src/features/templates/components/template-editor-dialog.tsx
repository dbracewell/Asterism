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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { PromptTemplate, TemplateDocument } from "@/lib/client";
import {
  promptTemplateCreateMutation,
  promptTemplateDeleteMutation,
  promptTemplateGetOneQueryKey,
  promptTemplateUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  blankDraft,
  documentBytes,
  draftSignature,
  duplicateName,
  fromDocument,
  hasIssues,
  LIMITS,
  newField,
  nextFieldKey,
  toDocument,
  updateField,
  validateDraft,
  type DraftField,
  type TemplateDraft,
} from "../lib/draft";
import {
  frameworkCatalogOptions,
  templateDetailOptions,
  templateMutationInvalidates,
} from "../queries";
import { TemplateBuilder } from "./template-builder";
import { TemplateFieldEditor } from "./template-field-editor";

export type EditorTarget =
  | { type: "new" }
  | { type: "edit"; id: string }
  | { type: "duplicate"; source: "framework" | "template"; id: string };

type Props = {
  owner: string;
  target: EditorTarget;
  onClose: (deleted?: boolean) => void;
  restoreFocus: () => void;
};

/** Server error text: a domain `detail` string or the first validation message. */
export function errorDetail(error: unknown) {
  if (error && typeof error === "object" && "detail" in error) {
    const { detail } = error;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string")
      return `Invalid template: ${detail[0].msg}`;
  }
  return "Retry, or reload the page if it keeps failing.";
}

export function TemplateEditorDialog(props: Props) {
  const { owner, target } = props;
  const detailId =
    target.type === "edit" ||
    (target.type === "duplicate" && target.source === "template")
      ? target.id
      : null;
  const detail = useQuery(templateDetailOptions(owner, detailId));
  const catalog = useQuery({
    ...frameworkCatalogOptions(),
    enabled: target.type === "duplicate" && target.source === "framework",
  });
  if (target.type === "new")
    return <LoadedTemplateEditor {...props} initial={null} start={null} />;
  const query = detailId === null ? catalog : detail;
  const source: TemplateDocument | undefined =
    detailId === null
      ? catalog.data?.items.find((item) => item.id === target.id)?.document
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
            <DialogTitle>Prompt template</DialogTitle>
            <DialogDescription>
              Load the current template before editing.
            </DialogDescription>
          </DialogHeader>
          {query.isPending ? (
            <FormSkeleton label="Loading template…" fields={3} />
          ) : (
            <QueryError
              error={query.error ?? new Error("Template not found")}
              message="Could not load this template."
              retry={query.refetch}
              isRetrying={query.isFetching}
            />
          )}
        </DialogContent>
      </Dialog>
    );
  if (target.type === "duplicate")
    return (
      <LoadedTemplateEditor
        {...props}
        initial={null}
        start={{ ...source, name: duplicateName(source.name) }}
      />
    );
  return (
    <LoadedTemplateEditor
      {...props}
      initial={detail.data ?? null}
      latest={detail.data ?? null}
      refreshError={detail.error}
      refreshing={detail.isFetching}
      reload={async () => {
        const result = await detail.refetch();
        return result.error ? undefined : result.data;
      }}
      start={null}
    />
  );
}

function LoadedTemplateEditor({
  initial,
  start,
  latest = null,
  reload,
  refreshError = null,
  refreshing = false,
  onClose,
  restoreFocus,
}: Props & {
  /** The saved template being edited, or `null` when creating. */
  initial: PromptTemplate | null;
  /** The document a new template starts from (duplicates); blank if `null`. */
  start: TemplateDocument | null;
  latest?: PromptTemplate | null;
  reload?: () => Promise<PromptTemplate | undefined>;
  refreshError?: unknown;
  refreshing?: boolean;
}) {
  const idPrefix = useId();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState<TemplateDraft>(() =>
    initial
      ? fromDocument(initial.document)
      : start
        ? fromDocument(start)
        : blankDraft(),
  );
  const [pristine, setPristine] = useState(() => draftSignature(draft));
  const [tab, setTab] = useState("edit");
  const [showIssues, setShowIssues] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const issuesRef = useRef<HTMLDivElement>(null);
  const addFieldRef = useRef<HTMLButtonElement>(null);

  const create = useMutation({
    ...promptTemplateCreateMutation({ client }),
    meta: { invalidates: templateMutationInvalidates() },
  });
  const update = useMutation({
    ...promptTemplateUpdateMutation({ client }),
    meta: {
      invalidates: [
        ...templateMutationInvalidates(),
        ...(baseline
          ? [
              promptTemplateGetOneQueryKey({
                path: { template_id: baseline.id },
              }),
            ]
          : []),
      ],
    },
  });
  const remove = useMutation({
    ...promptTemplateDeleteMutation({ client }),
    meta: { invalidates: templateMutationInvalidates() },
  });
  const [reloadPending, setReloadPending] = useState(false);
  const pending =
    create.isPending || update.isPending || remove.isPending || reloadPending;
  const signature = draftSignature(draft);
  const dirty = signature !== pristine;
  const adopt = (template: PromptTemplate) => {
    const next = fromDocument(template.document);
    setBaseline(template);
    setDraft(next);
    setPristine(draftSignature(next));
  };
  // A pristine editor may receive a newer cached-query result. Adopt it only
  // before any unsaved edits or in-flight mutation.
  if (
    baseline &&
    latest &&
    latest.revision > baseline.revision &&
    !dirty &&
    !pending
  )
    adopt(latest);
  const changed = !!baseline && !!latest && latest.revision > baseline.revision;
  const error = create.error ?? update.error ?? remove.error;
  const issues = validateDraft(draft);
  const invalid = hasIssues(issues);
  const templateDocument = toDocument(draft);
  const bytes = documentBytes(draft);

  const discard = useConfirmationDialog({
    title: "Discard unsaved template changes?",
    description: "Your unsaved changes will be lost.",
    confirmText: "Discard changes",
    confirmVariant: "destructive",
  });
  const deletion = useConfirmationDialog({
    title: `Delete ${baseline?.name ?? "template"}?`,
    description:
      "This deletes the template. Messages built with it keep their label, shown as unavailable.",
    confirmText: "Delete template",
    confirmVariant: "destructive",
  });
  const close = async () => {
    if (!pending && (!dirty || (await discard.confirm()))) onClose();
  };
  const reloadCurrent = async () => {
    if (!reload || (dirty && !(await discard.confirm()))) return;
    setReloadPending(true);
    try {
      const current = await reload();
      if (current) {
        adopt(current);
        update.reset();
        remove.reset();
      }
    } finally {
      setReloadPending(false);
    }
  };

  const setField = (uid: string, next: DraftField) =>
    setDraft((current) => updateField(current, uid, next));
  const focusLater = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  const moveField = (index: number, offset: -1 | 1) => {
    const fields = [...draft.fields];
    const [moved] = fields.splice(index, 1);
    fields.splice(index + offset, 0, moved);
    setDraft({ ...draft, fields });
    // Reordering can detach the focused button; keep keyboard users in place.
    const target = index + offset;
    const direction =
      offset < 0
        ? target > 0
          ? "up"
          : "down"
        : target < fields.length - 1
          ? "down"
          : "up";
    focusLater(`${idPrefix}-${moved.uid}-move-${direction}`);
  };
  const removeField = (uid: string) => {
    setDraft({
      ...draft,
      fields: draft.fields.filter((field) => field.uid !== uid),
    });
    requestAnimationFrame(() => addFieldRef.current?.focus());
  };
  const addField = () => {
    const field = newField(nextFieldKey(draft.fields));
    const separator = draft.body && !draft.body.endsWith("\n") ? "\n\n" : "";
    setDraft({
      ...draft,
      fields: [...draft.fields, field],
      body: `${draft.body}${separator}{{${field.key}}}`,
    });
    focusLater(`${idPrefix}-${field.uid}-label`);
  };
  const insertPlaceholder = (key: string) => {
    const element = bodyRef.current;
    const token = `{{${key}}}`;
    const start = element?.selectionStart ?? draft.body.length;
    const end = element?.selectionEnd ?? draft.body.length;
    setDraft({
      ...draft,
      body: draft.body.slice(0, start) + token + draft.body.slice(end),
    });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (pending || refreshing || changed) return;
    if (invalid) {
      setShowIssues(true);
      setTab("edit");
      requestAnimationFrame(() => issuesRef.current?.focus());
      return;
    }
    try {
      if (baseline)
        await update.mutateAsync({
          path: { template_id: baseline.id },
          body: {
            document: templateDocument,
            expected_revision: baseline.revision,
          },
        });
      else await create.mutateAsync({ body: { document: templateDocument } });
      toast.success(baseline ? "Template saved" : "Template created");
      onClose();
    } catch {
      /* Mutation errors stay visible with the draft. */
    }
  };
  const fieldIssues = (uid: string) =>
    showIssues ? (issues.fields[uid] ?? []) : [];

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
            {baseline ? `Edit ${baseline.name}` : "Create template"}
          </DialogTitle>
          <DialogDescription>
            Define the form fields and the prompt body. Template text is prompt
            content only; it grants no tools, files or other permissions.
          </DialogDescription>
        </DialogHeader>
        {discard.dialog}
        {deletion.dialog}
        {refreshError != null && reload && (
          <QueryError
            error={refreshError}
            message="Could not refresh this template. Your draft is retained."
            retry={reload}
            isRetrying={refreshing}
          />
        )}
        {changed && (
          <p role="status">
            A newer revision is available. Your draft has not changed. Reload
            before saving.
          </p>
        )}
        <form
          noValidate
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          onKeyDown={(event) => {
            // The editor has many single-line inputs; Enter in one of them
            // should not save the whole template.
            if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement
            )
              event.preventDefault();
          }}
        >
          <Tabs value={tab} onValueChange={setTab} className="min-w-0">
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="edit" className="flex min-w-0 flex-col gap-4">
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
                    {draft.fields.flatMap((field, index) =>
                      (issues.fields[field.uid] ?? []).map((issue) => (
                        <li key={`${field.uid}:${issue}`}>
                          Field {index + 1} ({field.label || field.key}):{" "}
                          {issue}
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
                  maxLength={LIMITS.name}
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
                  maxLength={LIMITS.description}
                  className="min-h-16"
                  disabled={pending}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
              </Field>
              <section
                aria-labelledby={`${idPrefix}-fields`}
                className="flex min-w-0 flex-col gap-3"
              >
                <h3 id={`${idPrefix}-fields`} className="font-medium">
                  Fields
                </h3>
                {draft.fields.map((field, index) => (
                  <TemplateFieldEditor
                    key={field.uid}
                    id={`${idPrefix}-${field.uid}`}
                    field={field}
                    index={index}
                    count={draft.fields.length}
                    disabled={pending}
                    issues={fieldIssues(field.uid)}
                    onChange={(next) => setField(field.uid, next)}
                    onMove={(offset) => moveField(index, offset)}
                    onRemove={() => removeField(field.uid)}
                  />
                ))}
                <Button
                  ref={addFieldRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={pending || draft.fields.length >= LIMITS.fields}
                  onClick={addField}
                >
                  <PlusIcon />
                  Add field
                </Button>
              </section>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-body`}>
                  Prompt body
                </FieldLabel>
                <Textarea
                  ref={bodyRef}
                  id={`${idPrefix}-body`}
                  value={draft.body}
                  maxLength={LIMITS.body}
                  className="min-h-40 font-mono"
                  disabled={pending}
                  aria-describedby={`${idPrefix}-body-help`}
                  onChange={(event) =>
                    setDraft({ ...draft, body: event.target.value })
                  }
                />
                <FieldDescription id={`${idPrefix}-body-help`}>
                  Write {"{{key}}"} where a field&apos;s value goes, and{" "}
                  {"\\{{"} for a literal {"{{"}. {bytes.toLocaleString()} /{" "}
                  {LIMITS.documentBytes.toLocaleString()} UTF-8 bytes.
                </FieldDescription>
                {draft.fields.length > 0 && (
                  <div
                    role="group"
                    aria-label="Insert a placeholder at the cursor"
                    className="flex flex-wrap gap-1"
                  >
                    {draft.fields.map((field) => (
                      <Button
                        key={field.uid}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="font-mono"
                        disabled={pending || !field.key}
                        aria-label={`Insert {{${field.key}}}`}
                        onClick={() => insertPlaceholder(field.key)}
                      >
                        {`{{${field.key}}}`}
                      </Button>
                    ))}
                  </div>
                )}
              </Field>
            </TabsContent>
            <TabsContent
              value="preview"
              className="flex min-w-0 flex-col gap-3"
            >
              <p className="text-muted-foreground">
                Try the form as a user would see it. Values you enter here are
                not saved.
              </p>
              {invalid && (
                <p role="status">
                  This template has problems to fix before saving; the preview
                  may be incomplete.
                </p>
              )}
              <TemplateBuilder key={signature} template={templateDocument} />
            </TabsContent>
          </Tabs>
          {error && (
            <EmptyState
              role="alert"
              className="flex-none items-start p-3 text-left"
              title="Could not save or delete template"
              description={errorDetail(error)}
            />
          )}
          <footer className="flex flex-wrap items-center justify-end gap-2">
            {baseline && (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending || refreshing || changed}
                  onClick={async () => {
                    if (!(await deletion.confirm())) return;
                    try {
                      await remove.mutateAsync({
                        path: { template_id: baseline.id },
                        query: { expected_revision: baseline.revision },
                      });
                      toast.success("Template deleted");
                      onClose(true);
                    } catch {
                      /* Keep the draft and revision on failure. */
                    }
                  }}
                >
                  Delete template
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || refreshing}
                  onClick={() => void reloadCurrent()}
                >
                  Reload current template
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
            <Button type="submit" disabled={pending || refreshing || changed}>
              {pending ? "Saving…" : "Save template"}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
