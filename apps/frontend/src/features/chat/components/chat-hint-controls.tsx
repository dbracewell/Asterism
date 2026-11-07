"use client";

import { useCourseModePolicy } from "./course-mode-policy";
import { HelpTopic } from "@/features/help/components/help-topic";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type {
  ChatInfo,
  HintLevel,
  HintRequest,
  LearningModeId,
} from "@/lib/client";
import { useQuery } from "@tanstack/react-query";
import { LightbulbIcon } from "lucide-react";
import { learningModeQueryOptions } from "./chat-learning-mode-picker";
import {
  DelayedConfirmAction,
  lockOverrideDelay,
} from "./delayed-confirm-action";

const ORDER: HintLevel[] = [
  "none",
  "nudge",
  "hint",
  "worked_example",
  "answer",
];

const tutorLabels: Record<HintLevel, string> = {
  none: "Questions only",
  nudge: "Nudge",
  hint: "Hint",
  worked_example: "Worked example",
  answer: "Answer shown",
};

/** Review offers only the reveal, which shows a corrected solution. */
const reviewLabels: Partial<Record<HintLevel, string>> = {
  none: "Feedback only",
  answer: "Solution shown",
};

/** The label of a hint level in the given learning mode. */
export function hintLevelLabel(
  mode: LearningModeId | undefined,
  level: HintLevel,
) {
  return (mode === "review" && reviewLabels[level]) || tutorLabels[level];
}

/** The message sent with each raise; the level, not the text, sets the help. */
export const hintPrompt: Record<
  Exclude<HintLevel, "none" | "answer">,
  string
> = {
  nudge: "Give me a nudge.",
  hint: "Give me a hint.",
  worked_example: "Show me a worked example.",
};

type RevealCopy = {
  action: string;
  title: string;
  description: string;
  prompt: string;
  reset: string;
};

const tutorReveal: RevealCopy = {
  action: "Show answer",
  title: "Show the full answer?",
  description:
    "Working it out yourself helps you learn it. If you are stuck, a hint or worked example may be enough. The tutor will give the full answer to this problem.",
  prompt: "Show me the answer.",
  reset: "New problem",
};

const reviewReveal: RevealCopy = {
  action: "Show solution",
  title: "Show a corrected solution?",
  description:
    "Fixing it yourself helps you learn it. Try the suggested next step first. The reviewer will write a full corrected version of your attempt.",
  prompt: "Show me a corrected solution.",
  reset: "New attempt",
};

/** The reveal action's wording in the given learning mode. */
export function revealCopy(mode: LearningModeId | undefined): RevealCopy {
  return mode === "review" ? reviewReveal : tutorReveal;
}

const rank = (level: HintLevel) => ORDER.indexOf(level);

/**
 * Tiered help for modes that offer hints. Each raise sends a turn at a higher
 * level for this branch; the answer (Tutor) or corrected solution (Review)
 * needs a confirmation. A reset applies to the next message the learner sends.
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
  // A class policy can turn reveals off in a course project (US-60.4).
  const revealAllowed =
    useCourseModePolicy(info.project_id)?.answer_reveal ?? true;
  const mode = catalog.data?.modes.find(
    (item) => item.id === info.learning_mode,
  );
  const offered = mode?.hint_levels ?? [];
  if (!offered.length) return null;
  const current: HintLevel = resetPending
    ? "none"
    : (info.hint_level ?? "none");
  const steps = offered.filter(
    (level): level is keyof typeof hintPrompt => level !== "answer",
  );
  const reveal = revealCopy(info.learning_mode);
  const locked = !!info.learning_mode_locked;
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
            {hintLevelLabel(info.learning_mode, current)}
          </span>
          {resetPending && " (from your next message)"}
        </span>
      </span>
      <HelpTopic
        id={
          info.learning_mode === "review"
            ? "concept.answer-reveal"
            : "concept.hint-levels"
        }
      />
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
              hintPrompt[level],
            )
          }
        >
          {hintLevelLabel(info.learning_mode, level)}
        </Button>
      ))}
      {offered.includes("answer") && revealAllowed && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={disabled || current === "answer"}
            >
              {reveal.action}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{reveal.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {reveal.description}
                {locked &&
                  " You locked this chat's mode, so take a moment before you decide."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep trying</AlertDialogCancel>
              <DelayedConfirmAction
                delaySeconds={lockOverrideDelay(info)}
                onConfirm={() =>
                  onRaise(
                    {
                      level: "answer",
                      confirm_reveal: true,
                      ...(locked ? { override_lock: true } : {}),
                      ...(resetPending ? { reset: true } : {}),
                    },
                    reveal.prompt,
                  )
                }
              >
                {reveal.action}
              </DelayedConfirmAction>
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
          {resetPending ? "Keep current level" : reveal.reset}
        </Button>
      )}
    </div>
  );
}
