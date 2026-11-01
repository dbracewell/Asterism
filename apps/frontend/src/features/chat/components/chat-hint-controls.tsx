"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ChatInfo, HintLevel, HintRequest } from "@/lib/client";
import { useQuery } from "@tanstack/react-query";
import { LightbulbIcon } from "lucide-react";
import { learningModeQueryOptions } from "./chat-learning-mode-picker";

const ORDER: HintLevel[] = [
  "none",
  "nudge",
  "hint",
  "worked_example",
  "answer",
];

export const hintLevelLabel: Record<HintLevel, string> = {
  none: "Questions only",
  nudge: "Nudge",
  hint: "Hint",
  worked_example: "Worked example",
  answer: "Answer shown",
};

/** The message sent with each raise; the level, not the text, sets the help. */
export const hintPrompt: Record<Exclude<HintLevel, "none">, string> = {
  nudge: "Give me a nudge.",
  hint: "Give me a hint.",
  worked_example: "Show me a worked example.",
  answer: "Show me the answer.",
};

const rank = (level: HintLevel) => ORDER.indexOf(level);

/**
 * Tiered help for modes that offer hints. Each raise sends a turn at a higher
 * level for this branch; the answer needs a confirmation. A reset applies to
 * the next message the learner sends.
 */
export function ChatHintControls({
  info,
  disabled,
  resetPending,
  onRaise,
  onResetChange,
}: {
  info: ChatInfo;
  disabled: boolean;
  resetPending: boolean;
  onRaise: (hint: HintRequest, prompt: string) => void;
  onResetChange: (reset: boolean) => void;
}) {
  const catalog = useQuery(learningModeQueryOptions());
  const mode = catalog.data?.modes.find(
    (item) => item.id === info.learning_mode,
  );
  const offered = mode?.hint_levels ?? [];
  if (!offered.length) return null;
  const current: HintLevel = resetPending
    ? "none"
    : (info.hint_level ?? "none");
  const steps = offered.filter((level) => level !== "answer");
  return (
    <div
      role="group"
      aria-label="Hint controls"
      className="flex flex-wrap items-center gap-1 px-2 pb-1 text-xs"
    >
      <span className="text-muted-foreground mr-1 inline-flex items-center gap-1">
        <LightbulbIcon aria-hidden className="size-3.5" />
        <span>
          Help level:{" "}
          <span
            className="text-foreground font-medium"
            data-hint-level={current}
          >
            {hintLevelLabel[current]}
          </span>
          {resetPending && " (from your next message)"}
        </span>
      </span>
      {steps.map((level) => (
        <Button
          key={level}
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled || rank(level) <= rank(current)}
          onClick={() =>
            onRaise(
              resetPending ? { level, reset: true } : { level },
              hintPrompt[level as Exclude<HintLevel, "none">],
            )
          }
        >
          {hintLevelLabel[level]}
        </Button>
      ))}
      {offered.includes("answer") && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={disabled || current === "answer"}
            >
              Show answer
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Show the full answer?</AlertDialogTitle>
              <AlertDialogDescription>
                Working it out yourself helps you learn it. If you are stuck, a
                hint or worked example may be enough. The tutor will give the
                full answer to this problem.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep trying</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  onRaise(
                    {
                      level: "answer",
                      confirm_reveal: true,
                      ...(resetPending ? { reset: true } : {}),
                    },
                    hintPrompt.answer,
                  )
                }
              >
                Show answer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {(current !== "none" || resetPending) && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={disabled}
          aria-pressed={resetPending}
          onClick={() => onResetChange(!resetPending)}
        >
          {resetPending ? "Keep current level" : "New problem"}
        </Button>
      )}
    </div>
  );
}
