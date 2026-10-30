import Constellation from "@/components/logo";
import { FieldDescription } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

/** Card surface shared by sign-in and every first-run setup step. */
export const authCardClassName =
  "bg-card text-card-foreground rounded-overlay shadow-overlay flex w-full min-w-0 flex-col gap-6 border p-5 sm:p-8";

/** Logo, wordmark and one-line description at the top of the auth card. */
export function AuthHeading({ description }: { description: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-3 text-center">
      <Constellation
        className="text-primary"
        fill="currentColor"
        size={56}
        strokeWidth={10}
      />
      <h1 className="text-title tracking-[0.18em] uppercase">Asterism</h1>
      <FieldDescription className="text-balance">
        {description}
      </FieldDescription>
    </div>
  );
}

const SETUP_STEPS = [
  {
    title: "Create the administrator account",
    detail: "This account manages providers, tools and users.",
  },
  {
    title: "Add a model provider",
    detail: "Connect a provider and enable a model.",
  },
  {
    title: "Start your first chat",
    detail: "Ask anything from the new-chat page.",
  },
];

/** First-run checklist; steps before `current` are complete. */
export function SetupSteps({ current }: { current: number }) {
  return (
    <ol
      aria-label="First-run setup"
      className="rounded-surface bg-muted/50 flex min-w-0 flex-col gap-3 p-4 text-left"
    >
      {SETUP_STEPS.map((step, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li
            key={step.title}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 gap-3"
          >
            <span
              aria-hidden="true"
              data-step-marker={complete ? "complete" : active ? "current" : ""}
              className={cn(
                "rounded-dot text-meta flex size-6 shrink-0 items-center justify-center font-semibold",
                active
                  ? "bg-primary text-primary-foreground"
                  : complete
                    ? "border-primary text-primary border"
                    : "border-border text-muted-foreground border",
              )}
            >
              {complete ? <CheckIcon className="size-3.5" /> : index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 wrap-anywhere">
              <span className="text-body font-medium">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
                {active && <span className="sr-only"> (current)</span>}
                {complete && <span className="sr-only"> (complete)</span>}
              </span>
              <span className="text-meta text-muted-foreground">
                {step.detail}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
