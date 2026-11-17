"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { StudyCard, StudyUnclearItem } from "@/lib/client";
import { studyUnclearCardCreateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

const CARD_SIDE_MAX = 4000;

/**
 * One "still unclear" item from a reflection (ADR-0050, ADR-0067). It becomes
 * a card only when the learner writes the answer and adds it; the question can
 * be reworded and the item still counts as done.
 */
export function UnclearItemForm({
  item,
  label,
  projectId,
  deckId,
  onAdded,
}: {
  item: StudyUnclearItem;
  label: string;
  projectId: string;
  deckId: string | null;
  onAdded: (card: StudyCard) => void;
}) {
  const id = useId();
  const [front, setFront] = useState(item.text.slice(0, CARD_SIDE_MAX));
  const [back, setBack] = useState("");
  const [weakSpot, setWeakSpot] = useState(true);
  const add = useMutation({
    ...studyUnclearCardCreateMutation({ client }),
    onSuccess: onAdded,
  });
  const busy = add.isPending || add.isSuccess;
  return (
    <li
      aria-label={label}
      className="border-border rounded-surface flex min-w-0 flex-col gap-3 border p-3"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (front.trim() && back.trim())
            add.mutate({
              path: { project_id: projectId },
              body: {
                reflection_id: item.reflection_id,
                item: item.text,
                deck_id: deckId,
                front: front.trim(),
                back: back.trim(),
                weak_spot: weakSpot,
              },
            });
        }}
      >
        <Field>
          <FieldLabel htmlFor={`${id}-front`}>Question</FieldLabel>
          <Textarea
            id={`${id}-front`}
            className="min-h-14"
            maxLength={CARD_SIDE_MAX}
            value={front}
            disabled={busy}
            onChange={(event) => setFront(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-back`}>Answer</FieldLabel>
          <Textarea
            id={`${id}-back`}
            className="min-h-14"
            maxLength={CARD_SIDE_MAX}
            value={back}
            disabled={busy}
            aria-describedby={`${id}-back-help`}
            onChange={(event) => setBack(event.target.value)}
          />
          <FieldDescription id={`${id}-back-help`}>
            Not sure yet? Note where to look it up.
          </FieldDescription>
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor={`${id}-weak`}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              id={`${id}-weak`}
              checked={weakSpot}
              disabled={busy}
              onCheckedChange={(checked) => setWeakSpot(checked === true)}
            />
            Also add to Needs practice
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={busy || !front.trim() || !back.trim()}
          >
            {busy ? "Adding…" : "Add card"}
          </Button>
        </div>
        {add.error && (
          <p role="alert" className="text-destructive text-sm">
            {errorDetail(add.error, "Could not add this card. Retry.")}
          </p>
        )}
      </form>
    </li>
  );
}
