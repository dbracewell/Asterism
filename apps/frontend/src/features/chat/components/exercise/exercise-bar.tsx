"use client";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EvidenceChip } from "@/features/chat/components/verification/verification-panel";
import {
  findQuoteRange,
  showClaimHighlights,
} from "@/features/chat/lib/claim-highlights";
import { studyErrorDetail } from "@/features/study/lib/error-detail";
import { client } from "@/lib/api";
import type { ExerciseView } from "@/lib/client";

type AttemptResult = ExerciseView["attempts"][number]["result"];
import {
  chatExerciseAttemptMutation,
  chatExerciseRevealMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { SearchCheckIcon } from "lucide-react";
import { useEffect, useId, useState, type RefObject } from "react";

export const ATTEMPT_FEEDBACK: Record<AttemptResult, string> = {
  found:
    "You found it. Reveal the answer to see the correction and the source.",
  too_broad:
    "The error is in your selection, but it is too broad. Narrow it down.",
  not_it: "That is not the deliberate error. Try another part.",
};

/** The text the learner selected inside the answer, if any. */
function selectionIn(root: HTMLElement | null): string {
  const selection =
    typeof window !== "undefined" ? window.getSelection() : null;
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount)
    return "";
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer)
    ? selection.toString().trim()
    : "";
}

/**
 * A spot-the-error answer (US-55.4): always labelled as an exercise. The
 * learner selects (or types) the part they think is wrong and checks it; the
 * server grades it against the recorded error without revealing it. Reveal
 * shows the error in the answer, its correction and the source that disproves
 * it. Quotes, corrections and excerpts are untrusted text.
 */
export function ExerciseBar({
  chatId,
  messageId,
  exercise,
  answerRef,
}: {
  chatId: string;
  messageId: string;
  exercise: ExerciseView;
  answerRef: RefObject<HTMLElement | null>;
}) {
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const inputId = useId();
  const attempt = useMutation(chatExerciseAttemptMutation({ client }));
  const reveal = useMutation(chatExerciseRevealMutation({ client }));
  const { confirm, dialog } = useConfirmationDialog({
    title: "Reveal the error?",
    description:
      "You will see the error, the correction and the source. You can't check more selections afterwards.",
    confirmText: "Reveal",
  });
  const last = exercise.attempts.at(-1);
  const open = exercise.valid && !exercise.revealed;

  // Visual highlight of the revealed error; the quote is also shown as text.
  useEffect(() => {
    const root = answerRef.current;
    if (!exercise.revealed || !exercise.quote || !root) return;
    const range = findQuoteRange(root, exercise.quote);
    return range
      ? showClaimHighlights(`exercise-${messageId}`, [
          { label: "contradicted", range },
        ])
      : undefined;
  }, [exercise.revealed, exercise.quote, messageId, answerRef]);

  const check = (selection: string) => {
    setNotice(null);
    if (!selection) {
      setNotice(
        "Select the part of the answer you think is wrong, or type it below.",
      );
      return;
    }
    attempt.mutate(
      {
        path: { chat_id: chatId, message_id: messageId },
        body: { selection },
      },
      { onSuccess: () => setTyped("") },
    );
  };
  const error = attempt.error ?? reveal.error;

  return (
    <div
      role="group"
      aria-label="Spot-the-error exercise"
      data-slot="exercise"
      className="border-border rounded-surface bg-card text-card-foreground my-2 flex min-w-0 flex-col gap-3 border p-3"
    >
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">
          <SearchCheckIcon aria-hidden data-icon="inline-start" />
          Exercise
        </Badge>
        <span>
          {exercise.valid
            ? "This answer contains one deliberate error. Find it."
            : "This exercise answer has no recorded error, so it can't be checked. Treat it with caution."}
        </span>
      </p>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={attempt.isPending}
              // Keep the learner's text selection when the button is pressed.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => check(selectionIn(answerRef.current))}
            >
              Check selection
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reveal.isPending}
              onClick={async () => {
                if (exercise.found || (await confirm()))
                  reveal.mutate({
                    path: { chat_id: chatId, message_id: messageId },
                  });
              }}
            >
              Reveal answer
            </Button>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              check(typed.trim());
            }}
          >
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor={inputId}>
                Or type the words you think are wrong
              </FieldLabel>
              <Input
                id={inputId}
                value={typed}
                maxLength={1000}
                onChange={(event) => setTyped(event.target.value)}
              />
              <FieldDescription>
                Copy them exactly from the answer.
              </FieldDescription>
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={attempt.isPending || !typed.trim()}
            >
              Check
            </Button>
          </form>
        </>
      )}
      <div role="status" className="flex flex-col gap-1 text-sm">
        {notice && <p>{notice}</p>}
        {last && !exercise.revealed && (
          <p
            data-attempt-result={last.result}
            className={cn(last.result === "found" && "font-medium")}
          >
            {ATTEMPT_FEEDBACK[last.result]}
          </p>
        )}
        {!!exercise.attempts.length && (
          <p className="text-muted-foreground text-meta">
            {exercise.attempts.length} of 20 checks used
            {exercise.found && " · found"}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(error, "That didn't work. Try again.")}
        </p>
      )}
      {exercise.revealed && exercise.valid && (
        <div className="flex flex-col gap-2" data-exercise="revealed">
          <p className="text-sm">
            <span className="font-medium">The error: </span>
            <span className="[overflow-wrap:anywhere]">“{exercise.quote}”</span>
          </p>
          {exercise.correction && (
            <p className="text-sm">
              <span className="font-medium">What is true: </span>
              <span className="[overflow-wrap:anywhere]">
                {exercise.correction}
              </span>
            </p>
          )}
          {exercise.source?.file_id ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Source:</span>
              <EvidenceChip
                chatId={chatId}
                evidence={{
                  file_id: exercise.source.file_id,
                  chunk_id: exercise.source.chunk_id ?? "",
                  artifact_generation: exercise.source.artifact_generation ?? 1,
                  name: exercise.source.name ?? "File",
                  excerpt: exercise.source.excerpt ?? "",
                  available: exercise.source.available,
                }}
              />
            </p>
          ) : (
            <p className="text-muted-foreground text-meta">
              No source from your files was recorded for this error.
            </p>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
