"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { PageHeaderSkeleton } from "@/components/loading-skeletons";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { StudyNote, StudyNoteSummary } from "@/lib/client";
import {
  studyNoteDeleteMutation,
  studyNoteGetOneOptions,
  studyNoteUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";
import { CardCitations } from "./card-citations";
import { NOTE_TITLE_MAX } from "./save-note";

export const NOTE_BODY_MAX = 100_000;

export function noteDescription(note: StudyNoteSummary) {
  const kind = note.kind === "summary" ? "Summary" : "Study guide";
  const by = note.model_name ? ` · written by ${note.model_name}` : "";
  return `${kind}${by} · updated ${new Date(note.updated_at * 1000).toLocaleDateString()}`;
}

export function NotePage({
  projectId,
  noteId,
}: {
  projectId: string;
  noteId: string;
}) {
  const router = useRouter();
  const path = { project_id: projectId, note_id: noteId };
  const note = useQuery({
    ...studyNoteGetOneOptions({ client, path }),
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    ...studyNoteDeleteMutation({ client }),
    onSuccess: () => router.push(`/projects/${projectId}`),
  });
  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${note.data?.title ?? "note"}?`,
    description: "The note will be deleted. Project files are not affected.",
    confirmVariant: "destructive",
    confirmText: "Delete note",
  });
  return (
    <PageLayout>
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to project
      </Link>
      {note.isPending && <PageHeaderSkeleton label="Loading note" />}
      {note.error && (
        <QueryError
          error={note.error}
          message="Could not load this note."
          retry={note.refetch}
          isRetrying={note.isFetching}
        />
      )}
      {note.data && (
        <>
          <PageHeader
            title={note.data.title}
            description={noteDescription(note.data)}
            actions={
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit note
                </Button>
                <Button
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (await confirm()) remove.mutate({ path });
                  }}
                >
                  {remove.isPending ? "Deleting…" : "Delete note"}
                </Button>
              </>
            }
          />
          {remove.error && (
            <p role="alert" className="text-destructive text-sm">
              {studyErrorDetail(remove.error, "Could not delete the note.")}
            </p>
          )}
          <article aria-label="Note" className="min-w-0">
            {/* Saved generated text is untrusted. */}
            <MarkdownViewer content={note.data.body} />
          </article>
          {note.data.citations.length > 0 && (
            <CardCitations citations={note.data.citations} />
          )}
          <EditNoteDialog
            projectId={projectId}
            note={note.data}
            open={editing}
            onOpenChange={setEditing}
          />
        </>
      )}
      {dialog}
    </PageLayout>
  );
}

function EditNoteDialog({
  projectId,
  note,
  open,
  onOpenChange,
}: {
  projectId: string;
  note: StudyNote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {open && (
          <EditNoteForm
            projectId={projectId}
            note={note}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditNoteForm({
  projectId,
  note,
  onDone,
}: {
  projectId: string;
  note: StudyNote;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const update = useMutation({
    ...studyNoteUpdateMutation({ client }),
    onSuccess: onDone,
  });
  const valid = title.trim() !== "" && body.trim() !== "";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        update.mutate({
          path: { project_id: projectId, note_id: note.id },
          body: { title: title.trim(), body },
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit note</DialogTitle>
        <DialogDescription>
          The body is Markdown. Sources stay as they were saved.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="note-edit-title">Title</FieldLabel>
          <Input
            id="note-edit-title"
            required
            data-1p-ignore
            maxLength={NOTE_TITLE_MAX}
            value={title}
            disabled={update.isPending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="note-edit-body">Body</FieldLabel>
          <Textarea
            id="note-edit-body"
            className="max-h-[60vh] min-h-64 font-mono text-sm"
            maxLength={NOTE_BODY_MAX}
            value={body}
            disabled={update.isPending}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
      </FieldGroup>
      {update.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(
            update.error,
            "Could not save the note. Try again.",
          )}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending || !valid}>
          {update.isPending ? "Saving…" : "Save note"}
        </Button>
      </DialogFooter>
    </form>
  );
}
