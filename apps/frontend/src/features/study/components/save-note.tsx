"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import type { StudyCitation, StudyNoteCreate } from "@/lib/client";
import { studyNoteCreateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";
import { citationInputs } from "./card-draft-review";

export const NOTE_TITLE_MAX = 120;

/** Title field and "Save as note" for a summary or study guide draft; opens the saved note. */
export function SaveNote({
  projectId,
  kind,
  defaultTitle,
  body,
  citations = [],
  modelId,
}: {
  projectId: string;
  kind: StudyNoteCreate["kind"];
  defaultTitle: string;
  body: string;
  citations?: StudyCitation[];
  modelId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle);
  const save = useMutation({
    ...studyNoteCreateMutation({ client }),
    onSuccess: (note) =>
      router.push(`/projects/${projectId}/study/notes/${note.id}`),
  });
  const busy = save.isPending || save.isSuccess;
  return (
    <form
      aria-label="Save as note"
      className="rounded-surface flex flex-col gap-3 border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || busy) return;
        save.mutate({
          path: { project_id: projectId },
          body: {
            kind,
            title: title.trim(),
            body,
            citations: citationInputs(citations),
            model_id: modelId,
          },
        });
      }}
    >
      <Field>
        <FieldLabel htmlFor="note-title">Note title</FieldLabel>
        <Input
          id="note-title"
          data-1p-ignore
          required
          maxLength={NOTE_TITLE_MAX}
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(save.error, "Could not save the note. Try again.")}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? "Saving…" : "Save as note"}
        </Button>
      </div>
    </form>
  );
}
