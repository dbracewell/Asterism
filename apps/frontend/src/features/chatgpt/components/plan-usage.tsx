"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { client } from "@/lib/api";
import { chatgptPlanUsageResumeMutation } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { ExternalLinkIcon, MessageCircleIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** OpenAI's usage page for plan limits and per-app access. */
export const MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";
export const CHATGPT_SETTINGS_PATH = "/settings?t=user&setting=chatgpt";
const PLAN_CODE_PREFIX = "chatgpt_plan_";

export const isPlanErrorCode = (code?: string | null): code is string =>
  !!code?.startsWith(PLAN_CODE_PREFIX);

export function ManageUsageLink({
  variant = "link",
  className,
}: {
  variant?: "link" | "default";
  className?: string;
}) {
  return (
    <a
      href={MANAGE_USAGE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        buttonVariants({ variant, size: "sm" }),
        variant === "link" && "h-auto px-0",
        className,
      )}
    >
      Manage usage
      <ExternalLinkIcon aria-hidden="true" />
      <span className="sr-only">(opens ChatGPT settings in a new tab)</span>
    </a>
  );
}

/** "Using ChatGPT plan" label shown beside the composer's model selector. */
export function PlanUsageIndicator({ className }: { className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "text-muted-foreground flex items-center gap-1.5 px-1 text-xs",
        className,
      )}
    >
      <MessageCircleIcon aria-hidden="true" className="size-4" />
      <span>Using ChatGPT plan</span>
      <span aria-hidden="true">·</span>
      <ManageUsageLink className="text-xs" />
    </p>
  );
}

function ConnectLink({ children }: { children: ReactNode }) {
  return (
    <Link
      href={CHATGPT_SETTINGS_PATH}
      className={buttonVariants({ variant: "default", size: "sm" })}
    >
      {children}
    </Link>
  );
}

function ResumePlanButton() {
  const resume = useMutation(chatgptPlanUsageResumeMutation({ client }));
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={resume.isPending}
        onClick={() => resume.mutate({})}
      >
        {resume.isPending ? "Trying again…" : "Try my plan again"}
      </Button>
      {resume.isError && (
        <span className="text-destructive text-xs">
          Could not resume your plan. Try again.
        </span>
      )}
    </>
  );
}

type Recovery = { title: string; body: string; actions?: ReactNode };

function recoveryFor(code: string, fallback: string): Recovery {
  switch (code.slice(PLAN_CODE_PREFIX.length)) {
    case "usage_limit":
      return {
        title: "Usage limit reached",
        body: "Review your plan or this app's limit in ChatGPT settings. Your plan stays paused until you try it again; you can also choose another model.",
        actions: (
          <>
            <ManageUsageLink variant="default" />
            <ResumePlanButton />
          </>
        ),
      };
    case "temporarily_unavailable":
      return {
        title: "ChatGPT plan temporarily unavailable",
        body: "ChatGPT could not check your plan usage. Try again in a moment, or choose another model.",
      };
    case "reauthorization_required":
      return {
        title: "Sign in to ChatGPT again",
        body: "Your ChatGPT session ended. Continue with ChatGPT in User Settings to keep using your plan.",
        actions: <ConnectLink>Connect ChatGPT</ConnectLink>,
      };
    case "not_connected":
      return {
        title: "ChatGPT is not connected",
        body: "Connect your ChatGPT plan in User Settings to use this model.",
        actions: <ConnectLink>Connect ChatGPT</ConnectLink>,
      };
    case "plan_usage_disabled":
      return {
        title: "Plan usage is not allowed",
        body: "ChatGPT did not allow plan usage for this app. Continue with ChatGPT in User Settings to allow it.",
        actions: <ConnectLink>Open ChatGPT settings</ConnectLink>,
      };
    case "policy_disabled":
      return {
        title: "ChatGPT plans are turned off",
        body: "Your administrator has turned off ChatGPT plan connections. Choose another model to continue.",
      };
    default:
      return { title: "ChatGPT plan request failed", body: fallback };
  }
}

/**
 * Recovery for a ChatGPT plan failure, keyed by its stable code. "Manage
 * usage" is the primary action for usage limits; choosing another model is
 * always left to the user.
 */
export function PlanRecoveryNotice({
  code,
  message,
  onDismiss,
  className,
}: {
  code: string;
  message: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const recovery = recoveryFor(code, message);
  return (
    <div
      role="alert"
      aria-label={recovery.title}
      className={cn(
        "border-border bg-card rounded-surface flex w-full flex-col gap-2 border px-3 py-2 text-sm",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <MessageCircleIcon aria-hidden="true" className="size-4" />
        <span>{recovery.title}</span>
      </p>
      <p className="text-muted-foreground">{recovery.body}</p>
      {(recovery.actions || onDismiss) && (
        <div className="flex flex-wrap items-center gap-2">
          {recovery.actions}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
