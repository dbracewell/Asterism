"use client";

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
import type { StudyDeck } from "@/lib/client";
import {
  studyDeckCreateMutation,
  studyDeckUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";

export const DECK_NAME_MAX = 120;
export const DECK_DESCRIPTION_MAX = 2000;

/** Creates a deck when `deck` is absent, otherwise edits its name and description. */
export function DeckFormDialog({
  projectId,
  deck,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  deck?: StudyDeck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (deck: StudyDeck) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <DeckForm
            projectId={projectId}
            deck={deck}
            onDone={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeckForm({
  projectId,
  deck,
  onDone,
  onCancel,
}: {
  projectId: string;
  deck?: StudyDeck;
  onDone: (deck: StudyDeck) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(deck?.name ?? "");
  const [description, setDescription] = useState(deck?.description ?? "");
  const create = useMutation({
    ...studyDeckCreateMutation({ client }),
    onSuccess: onDone,
  });
  const update = useMutation({
    ...studyDeckUpdateMutation({ client }),
    onSuccess: onDone,
  });
  const error = create.error ?? update.error;
  const pending = create.isPending || update.isPending;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = { name: name.trim(), description };
        if (!body.name) return;
        if (deck)
          update.mutate({
            path: { project_id: projectId, deck_id: deck.id },
            body,
          });
        else create.mutate({ path: { project_id: projectId }, body });
      }}
    >
      <DialogHeader>
        <DialogTitle>{deck ? "Edit deck" : "New deck"}</DialogTitle>
        <DialogDescription>
          Decks group flashcards for this project.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="deck-name">Name</FieldLabel>
          <Input
            id="deck-name"
            required
            data-1p-ignore
            maxLength={DECK_NAME_MAX}
            value={name}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="deck-description">Description</FieldLabel>
          <Textarea
            id="deck-description"
            maxLength={DECK_DESCRIPTION_MAX}
            value={description}
            disabled={pending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </FieldGroup>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(error, "Could not save the deck. Try again.")}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Saving…" : deck ? "Save deck" : "Create deck"}
        </Button>
      </DialogFooter>
    </form>
  );
}
