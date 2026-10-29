"use client";

import { FormSkeleton } from "@/components/loading-skeletons";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import MarkdownViewer from "@/components/markdown-viewer";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { Skill } from "@/lib/client";
import {
  skillCreateMutation,
  skillUpdateMutation,
  skillDeleteMutation,
  skillGetOneQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { skillDetailOptions, skillMutationInvalidates } from "../queries";
import { SkillFailure } from "./skill-status";

export const SKILL_TEMPLATE =
  "---\nname: my-skill\ndescription: Describe when this skill should be used.\n---\n\n# Instructions\nDescribe the steps the agent should follow.\n";

function previewBody(source: string) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") return source;
  const end = lines.indexOf("---", 1);
  return end < 0 ? source : lines.slice(end + 1).join("\n");
}

type Props = {
  owner: string;
  skillId: string | null;
  onClose: (deleted?: boolean) => void;
  restoreFocus: () => void;
};
export function SkillEditorDialog(props: Props) {
  const detail = useQuery(skillDetailOptions(props.owner, props.skillId));
  if (props.skillId !== null && !detail.data)
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
            <DialogTitle>Skill document</DialogTitle>
            <DialogDescription>
              Load the current document before editing.
            </DialogDescription>
          </DialogHeader>
          {detail.isPending ? (
            <FormSkeleton label="Loading skill…" fields={2} />
          ) : (
            <QueryError
              error={detail.error}
              message="Could not load skill."
              retry={detail.refetch}
              isRetrying={detail.isFetching}
            />
          )}
        </DialogContent>
      </Dialog>
    );
  return (
    <LoadedSkillEditor
      {...props}
      initial={detail.data ?? null}
      latest={detail.data ?? null}
      refreshError={detail.error}
      refreshing={detail.isFetching}
      reload={async () => {
        const result = await detail.refetch();
        return result.error ? undefined : result.data;
      }}
    />
  );
}

function LoadedSkillEditor({
  initial,
  latest,
  reload,
  refreshError,
  refreshing,
  onClose,
  restoreFocus,
}: Props & {
  initial: Skill | null;
  latest: Skill | null;
  reload: () => Promise<Skill | undefined>;
  refreshError: unknown;
  refreshing: boolean;
}) {
  const [baseline, setBaseline] = useState(initial);
  const [content, setContent] = useState(initial?.content ?? SKILL_TEMPLATE);
  const [tab, setTab] = useState(initial ? "preview" : "source");
  const create = useMutation({
    ...skillCreateMutation({ client }),
    meta: { invalidates: skillMutationInvalidates() },
  });
  const update = useMutation({
    ...skillUpdateMutation({ client }),
    meta: {
      invalidates: [
        ...skillMutationInvalidates(),
        ...(baseline
          ? [skillGetOneQueryKey({ path: { skill_id: baseline.id } })]
          : []),
      ],
    },
  });
  const remove = useMutation({
    ...skillDeleteMutation({ client }),
    meta: { invalidates: skillMutationInvalidates() },
  });
  const [reloadPending, setReloadPending] = useState(false);
  const pending =
    create.isPending || update.isPending || remove.isPending || reloadPending;
  const dirty = content !== (baseline?.content ?? SKILL_TEMPLATE);
  // A freshly reopened/pristine editor may receive a newer cached-query result.
  // Adopt it only before any unsaved edits or in-flight mutation.
  if (
    baseline &&
    latest &&
    latest.revision > baseline.revision &&
    !dirty &&
    !pending
  ) {
    setBaseline(latest);
    setContent(latest.content);
  }

  const changed = !!baseline && !!latest && latest.revision > baseline.revision;
  const error = create.error ?? update.error ?? remove.error;
  const discard = useConfirmationDialog({
    title: "Discard unsaved skill changes?",
    description: "Your unsaved source changes will be lost.",
    confirmText: "Discard changes",
    confirmVariant: "destructive",
  });
  const deletion = useConfirmationDialog({
    title: `Delete ${baseline?.name ?? "skill"}?`,
    description:
      "This deletes the skill and removes its main-agent assignment. Recorded chat history is retained.",
    confirmText: "Delete skill",
    confirmVariant: "destructive",
  });
  const close = async () => {
    if (!pending && (!dirty || (await discard.confirm()))) onClose();
  };
  const reloadCurrent = async () => {
    if (dirty && !(await discard.confirm())) return;
    setReloadPending(true);
    try {
      const current = await reload();
      if (current) {
        setBaseline(current);
        setContent(current.content);
        update.reset();
        remove.reset();
      }
    } finally {
      setReloadPending(false);
    }
  };
  const bytes = new TextEncoder().encode(content).length;
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
            {baseline ? baseline.name : "Create skill"}
          </DialogTitle>
          <DialogDescription>
            SKILL.md source with name and description frontmatter. Instructions
            only; no scripts or additional permissions.
          </DialogDescription>
        </DialogHeader>
        {discard.dialog}
        {deletion.dialog}
        {refreshError != null && (
          <QueryError
            error={refreshError}
            message="Could not refresh this skill. Your draft is retained."
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
          className="flex min-w-0 flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              pending ||
              refreshing ||
              changed ||
              !content.trim() ||
              bytes > 65536
            )
              return;
            try {
              if (baseline)
                await update.mutateAsync({
                  path: { skill_id: baseline.id },
                  body: { content, expected_revision: baseline.revision },
                });
              else await create.mutateAsync({ body: { content } });
              toast.success(baseline ? "Skill saved" : "Skill created");
              onClose();
            } catch {
              /* Mutation errors stay visible with the original draft. */
            }
          }}
        >
          <Tabs value={tab} onValueChange={setTab} className="min-w-0">
            <TabsList>
              <TabsTrigger value="source">Source</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="source">
              <Field>
                <FieldLabel htmlFor="skill-document">
                  SKILL.md source
                </FieldLabel>
                <Textarea
                  id="skill-document"
                  className="min-h-56 max-w-full font-mono"
                  value={content}
                  disabled={pending}
                  onChange={(event) => setContent(event.target.value)}
                />
                <FieldDescription>
                  {bytes.toLocaleString()} / 65,536 UTF-8 bytes. The server
                  validates frontmatter when saving.
                </FieldDescription>
              </Field>
            </TabsContent>
            <TabsContent value="preview" className="min-w-0">
              <section
                aria-label="Skill preview"
                className="rounded-surface min-h-40 min-w-0 border p-3"
              >
                <MarkdownViewer content={previewBody(content)} />
              </section>
            </TabsContent>
          </Tabs>
          {bytes > 65536 && (
            <p role="alert">Skill source exceeds the 65,536-byte limit.</p>
          )}
          {error && (
            <SkillFailure
              error={error}
              title="Could not save or delete skill"
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
                    if (await deletion.confirm()) {
                      try {
                        await remove.mutateAsync({
                          path: { skill_id: baseline.id },
                          query: { expected_revision: baseline.revision },
                        });
                        toast.success("Skill deleted");
                        onClose(true);
                      } catch {
                        /* Keep the draft and revision on failure. */
                      }
                    }
                  }}
                >
                  Delete skill
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || refreshing}
                  onClick={() => void reloadCurrent()}
                >
                  Reload current skill
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
            <Button
              type="submit"
              disabled={
                pending ||
                refreshing ||
                changed ||
                !content.trim() ||
                bytes > 65536
              }
            >
              {pending ? "Saving…" : "Save skill"}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
