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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { StudyCard } from "@/lib/client";
import {
  studyCardCreateMutation,
  studyCardUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";

export const CARD_SIDE_MAX = 4000;

/**
 * Adds a card when `card` is absent, otherwise edits its front and back.
 * Editing never sends citations, so existing ones are kept.
 */
export function CardFormDialog({
  projectId,
  deckId,
  card,
  open,
  onOpenChange,
}: {
  projectId: string;
  deckId: string;
  card?: StudyCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <CardForm
            projectId={projectId}
            deckId={deckId}
            card={card}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardForm({
  projectId,
  deckId,
  card,
  onDone,
}: {
  projectId: string;
  deckId: string;
  card?: StudyCard;
  onDone: () => void;
}) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const create = useMutation({
    ...studyCardCreateMutation({ client }),
    onSuccess: onDone,
  });
  const update = useMutation({
    ...studyCardUpdateMutation({ client }),
    onSuccess: onDone,
  });
  const error = create.error ?? update.error;
  const pending = create.isPending || update.isPending;
  const valid = front.trim() !== "" && back.trim() !== "";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        const body = { front: front.trim(), back: back.trim() };
        if (card)
          update.mutate({
            path: { project_id: projectId, deck_id: deckId, card_id: card.id },
            body,
          });
        else
          create.mutate({
            path: { project_id: projectId, deck_id: deckId },
            body,
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>{card ? "Edit card" : "New card"}</DialogTitle>
        <DialogDescription>
          Write a question or prompt on the front and the answer on the back.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="card-front">Front</FieldLabel>
          <Textarea
            id="card-front"
            required
            maxLength={CARD_SIDE_MAX}
            value={front}
            disabled={pending}
            onChange={(event) => setFront(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="card-back">Back</FieldLabel>
          <Textarea
            id="card-back"
            required
            maxLength={CARD_SIDE_MAX}
            value={back}
            disabled={pending}
            onChange={(event) => setBack(event.target.value)}
          />
          <FieldDescription>Markdown and math are supported.</FieldDescription>
        </Field>
      </FieldGroup>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(error, "Could not save the card. Try again.")}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Saving…" : card ? "Save card" : "Add card"}
        </Button>
      </DialogFooter>
    </form>
  );
}
