import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { client } from "@/lib/api";
import { promptCoachReviewMutation } from "@/lib/client/@tanstack/react-query.gen";
import type { PromptReview, PromptSuggestion } from "@/lib/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  CheckIcon,
  ClipboardCheckIcon,
  ColumnsIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { applySuggestion, criterionLabel } from "../lib/coach";
import { coachStatusOptions } from "../queries";

export const COACH_UNAVAILABLE_HINT =
  "Prompt review needs a draft model or a connected ChatGPT plan";

const errorDetail = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "detail" in error &&
  typeof error.detail === "string"
    ? error.detail
    : "The prompt could not be reviewed. Try again.";

/**
 * One composer's prompt-coach session. The review lives only in this state:
 * it is never saved with the draft, sent to the chat, or stored by the server.
 * `original` is the draft as it was when reviewed (the "before" prompt).
 */
export function usePromptCoach(owner: string, modelId?: string | null) {
  const status = useQuery(coachStatusOptions(owner));
  const review = useMutation({
    ...promptCoachReviewMutation({ client }),
    // A review changes no server state, so it must not refetch anything.
    meta: { skipGlobalInvalidation: true },
  });
  const [session, setSession] = useState<{
    original: string;
    applied: string[];
  } | null>(null);
  const available = status.data?.available === true;
  return {
    available,
    checking: status.isPending,
    open: session !== null,
    original: session?.original ?? null,
    applied: session?.applied ?? [],
    pending: review.isPending,
    error: review.error,
    review: review.data as PromptReview | undefined,
    run(prompt: string) {
      if (!available || !prompt.trim()) return;
      setSession({ original: prompt, applied: [] });
      review.mutate({ body: { prompt, model_id: modelId ?? null } });
    },
    markApplied(id: string) {
      setSession((current) =>
        current ? { ...current, applied: [...current.applied, id] } : current,
      );
    },
    dismiss() {
      review.reset();
      setSession(null);
    },
  };
}

export type PromptCoachControl = ReturnType<typeof usePromptCoach>;

/** Mounts the coach only for owners who turned it on. */
export function PromptCoachScope({
  owner,
  modelId,
  children,
}: {
  owner: string;
  modelId?: string | null;
  children: (coach: PromptCoachControl) => React.ReactNode;
}) {
  return children(usePromptCoach(owner, modelId));
}

export function PromptCoachButton({
  coach,
  prompt,
  disabled,
}: {
  coach: PromptCoachControl;
  prompt: string;
  disabled?: boolean;
}) {
  const unavailable = !coach.checking && !coach.available;
  return (
    <Hint hint={unavailable ? COACH_UNAVAILABLE_HINT : "Review prompt"}>
      {/* A wrapper keeps the hint reachable while the button is disabled. */}
      <span tabIndex={unavailable ? 0 : undefined} className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="rounded-control"
          aria-label="Review prompt"
          aria-description={unavailable ? COACH_UNAVAILABLE_HINT : undefined}
          disabled={
            disabled || !coach.available || coach.pending || !prompt.trim()
          }
          onClick={() => coach.run(prompt)}
        >
          <ClipboardCheckIcon />
        </Button>
      </span>
    </Hint>
  );
}

export function PromptCoachPanel({
  coach,
  prompt,
  disabled,
  onApply,
  onRetry,
  onCompare,
}: {
  coach: PromptCoachControl;
  prompt: string;
  disabled?: boolean;
  onApply: (text: string) => void;
  onRetry: () => void;
  /**
   * Runs the reviewed original and the current draft side by side (US-51.7);
   * offered once a suggestion has been applied.
   */
  onCompare?: () => void;
}) {
  if (!coach.open) return null;
  const suggestions = coach.review?.suggestions ?? [];
  return (
    <section
      aria-label="Prompt review"
      className="bg-background rounded-surface mx-3 mt-2 flex max-h-64 min-w-0 flex-col overflow-y-auto border text-sm"
    >
      <header className="flex items-center gap-2 py-1 pr-1 pl-3">
        <p className="min-w-0 flex-1 truncate font-medium">Prompt review</p>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Dismiss prompt review"
          onClick={coach.dismiss}
        >
          <XIcon />
        </Button>
      </header>
      <div aria-live="polite" className="min-w-0 px-3 pb-2">
        {coach.pending ? (
          <p className="text-muted-foreground flex items-center gap-2">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Reviewing your prompt…
          </p>
        ) : coach.error ? (
          <div className="flex flex-wrap items-center gap-2">
            <p
              role="alert"
              className="text-destructive flex min-w-0 items-start gap-1.5"
            >
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{errorDetail(coach.error)}</span>
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={onRetry}
            >
              Retry
            </Button>
          </div>
        ) : suggestions.length === 0 ? (
          <p className="text-muted-foreground">
            This prompt already covers the goal, audience, context, constraints,
            output format and examples. Nothing to add.
          </p>
        ) : (
          <ul aria-label="Suggestions" className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <SuggestionItem
                key={suggestion.id}
                suggestion={suggestion}
                applied={coach.applied.includes(suggestion.id)}
                result={applySuggestion(prompt, suggestion)}
                disabled={disabled}
                onApply={(text) => {
                  onApply(text);
                  coach.markApplied(suggestion.id);
                }}
              />
            ))}
          </ul>
        )}
        {onCompare && coach.applied.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
            <p className="text-muted-foreground min-w-0 flex-1 text-xs">
              See what your changes do: send the original and the improved
              prompt to the same model and compare the answers.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || prompt.trim() === coach.original?.trim()}
              onClick={onCompare}
            >
              <ColumnsIcon />
              Compare before/after
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function SuggestionItem({
  suggestion,
  applied,
  result,
  disabled,
  onApply,
}: {
  suggestion: PromptSuggestion;
  applied: boolean;
  result: string | null;
  disabled?: boolean;
  onApply: (text: string) => void;
}) {
  const label = criterionLabel[suggestion.criterion];
  return (
    <li className="flex min-w-0 items-start gap-2 [overflow-wrap:anywhere]">
      <span
        aria-hidden="true"
        className="border-border rounded-control mt-0.5 flex size-4 shrink-0 items-center justify-center border"
      >
        {applied && <CheckIcon className="size-3" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p>
          <Badge variant="secondary" className="mr-1.5 align-middle">
            {label}
          </Badge>
          {suggestion.message}
        </p>
        <p className="text-muted-foreground text-xs">
          {suggestion.find ? (
            <>
              Replace <q className="line-through">{suggestion.find}</q> with{" "}
              <q>{suggestion.text}</q>
            </>
          ) : (
            <>
              Add <q>{suggestion.text}</q>
            </>
          )}
        </p>
      </div>
      {applied ? (
        <span className="text-muted-foreground shrink-0 text-xs">Applied</span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={disabled || result === null}
          title={
            result === null
              ? "The draft no longer contains this text"
              : undefined
          }
          aria-label={`Apply ${label.toLowerCase()} suggestion`}
          onClick={() => result !== null && onApply(result)}
        >
          Apply
        </Button>
      )}
    </li>
  );
}
