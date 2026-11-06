"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { Reflection } from "@/lib/client";
import {
  studyDeckGetManyOptions,
  studyUnclearCardCreateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { unclearItems } from "../lib/unclear-items";

const NEW_DECK = "new";
const CARD_SIDE_MAX = 4000;

function detail(error: unknown) {
  return error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
    ? error.detail
    : "Could not add this card. Retry.";
}

/**
 * Turns a reflection's "still unclear" items into practice (US-58.4). Each
 * item needs its own confirmation: the learner rewords the question, writes
 * the answer and adds that one card.
 */
export function UnclearPracticeDialog({
  reflection,
  projectId,
  open,
  onOpenChange,
}: {
  reflection: Reflection;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
          <UnclearItems reflection={reflection} projectId={projectId} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function UnclearItems({
  reflection,
  projectId,
}: {
  reflection: Reflection;
  projectId: string;
}) {
  const id = useId();
  const [deck, setDeck] = useState(NEW_DECK);
  const decks = useQuery({
    ...studyDeckGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page: 1, page_size: 100 },
    }),
    retry: false,
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>Practice what&apos;s unclear</DialogTitle>
        <DialogDescription>
          Each item becomes a flashcard only when you add it. Reword the
          question if you like, and write the answer once you&apos;ve found it.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={`${id}-deck`}>Add cards to</FieldLabel>
        <Select value={deck} onValueChange={setDeck}>
          <SelectTrigger id={`${id}-deck`} className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_DECK}>Unclear items deck</SelectItem>
            {decks.data?.items
              .filter((item) => item.name !== "Unclear items")
              .map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {unclearItems(reflection.unclear).map((item, index) => (
          <UnclearItem
            key={item}
            item={item}
            index={index}
            reflectionId={reflection.id}
            projectId={projectId}
            deckId={deck === NEW_DECK ? null : deck}
          />
        ))}
      </ol>
    </>
  );
}

function UnclearItem({
  item,
  index,
  reflectionId,
  projectId,
  deckId,
}: {
  item: string;
  index: number;
  reflectionId: string;
  projectId: string;
  deckId: string | null;
}) {
  const id = useId();
  const [front, setFront] = useState(item.slice(0, CARD_SIDE_MAX));
  const [back, setBack] = useState("");
  const [weakSpot, setWeakSpot] = useState(true);
  const add = useMutation(studyUnclearCardCreateMutation({ client }));
  const added = add.isSuccess;
  const label = `Item ${index + 1}`;
  return (
    <li
      aria-label={label}
      className="border-border rounded-surface flex min-w-0 flex-col gap-3 border p-3"
    >
      {added ? (
        <p role="status" className="flex items-start gap-2 text-sm">
          <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 wrap-anywhere">Card added: {front}</span>
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (front.trim() && back.trim())
              add.mutate({
                path: { project_id: projectId },
                body: {
                  reflection_id: reflectionId,
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
              disabled={add.isPending}
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
              disabled={add.isPending}
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
                disabled={add.isPending}
                onCheckedChange={(checked) => setWeakSpot(checked === true)}
              />
              Also add to weak spots
            </label>
            <Button
              type="submit"
              size="sm"
              disabled={add.isPending || !front.trim() || !back.trim()}
            >
              {add.isPending ? "Adding…" : "Add card"}
            </Button>
          </div>
          {add.error && (
            <p role="alert" className="text-destructive text-sm">
              {detail(add.error)}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
