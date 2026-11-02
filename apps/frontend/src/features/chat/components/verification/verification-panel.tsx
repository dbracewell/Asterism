"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { scopedFileHref } from "@/features/chat/components/chat-file-context";
import { formatDuration } from "@/features/chat/lib/agent-timeline";
import {
  type ClaimLabel,
  findQuoteRange,
  showClaimHighlights,
} from "@/features/chat/lib/claim-highlights";
import type {
  ClaimEvidence,
  MessageVerification,
  VerifiedClaim,
} from "@/lib/client";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleMinusIcon,
  CircleXIcon,
  FileTextIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type RefObject } from "react";

export const LABELS: Record<
  ClaimLabel,
  {
    text: string;
    Icon: LucideIcon;
    variant: "secondary" | "destructive" | "outline";
  }
> = {
  supported: { text: "Supported", Icon: CircleCheckIcon, variant: "secondary" },
  contradicted: {
    text: "Contradicted",
    Icon: CircleXIcon,
    variant: "destructive",
  },
  unsupported: {
    text: "Unsupported",
    Icon: CircleHelpIcon,
    variant: "outline",
  },
  unchecked: { text: "Not checked", Icon: CircleMinusIcon, variant: "outline" },
};

const ORDER: ClaimLabel[] = [
  "contradicted",
  "unsupported",
  "supported",
  "unchecked",
];

export function verificationSummary(verification: MessageVerification) {
  const counts = new Map<ClaimLabel, number>();
  for (const claim of verification.claims)
    counts.set(claim.label, (counts.get(claim.label) ?? 0) + 1);
  return ORDER.filter((label) => counts.get(label))
    .map((label) => `${counts.get(label)} ${LABELS[label].text.toLowerCase()}`)
    .join(" · ");
}

export function usageSummary({ usage }: MessageVerification) {
  const {
    claims_checked,
    claims_found,
    model_calls = 0,
    searches = 0,
    input_tokens = 0,
    output_tokens = 0,
    duration_ms = 0,
  } = usage;
  return [
    `${claims_checked} of ${formatPlural(claims_found, "claim")} checked`,
    formatPlural(model_calls, "model call"),
    formatPlural(searches, "search", "searches"),
    input_tokens + output_tokens > 0 &&
      `${input_tokens.toLocaleString()} in / ${output_tokens.toLocaleString()} out tokens`,
    formatDuration(duration_ms),
  ]
    .filter(Boolean)
    .join(" · ");
}

function limitNotes({ usage }: MessageVerification): string[] {
  return [
    usage.claims_truncated &&
      `Only the first ${usage.claim_limit} claims were checked.`,
    usage.answer_truncated &&
      "The answer was too long; only its beginning was read.",
    usage.timed_out &&
      "The time limit was reached before every claim was checked.",
  ].filter((note): note is string => !!note);
}

/**
 * The stored result of a verify pass (US-55.2): one label per claim with the
 * passages used, the verifier's model and time, and what the pass spent.
 * Claims, explanations and excerpts are untrusted text and render as text.
 * While open, matching quotes are highlighted in the answer above.
 */
export function VerificationPanel({
  chatId,
  messageId,
  verification,
  answerRef,
}: {
  chatId: string;
  messageId: string;
  verification: MessageVerification;
  answerRef: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const contentId = useId();
  const when = new Date(verification.created_at).toLocaleString();

  // Visual highlights only; the list below carries every label as text.
  useEffect(() => {
    const root = answerRef.current;
    if (!open || !highlight || !root) return;
    const ranges = verification.claims.flatMap((claim) => {
      if (!claim.quote || claim.label === "unchecked") return [];
      const range = findQuoteRange(root, claim.quote);
      return range ? [{ label: claim.label, range }] : [];
    });
    return showClaimHighlights(messageId, ranges);
  }, [open, highlight, verification, messageId, answerRef]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-border rounded-surface bg-card text-card-foreground my-2 border"
      data-slot="verification"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-between gap-2 px-3 py-2 text-left whitespace-normal"
          aria-controls={contentId}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">Verification</span>
            <span className="text-muted-foreground text-meta">
              {verificationSummary(verification) || "No claims found"}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        id={contentId}
        className="flex flex-col gap-3 px-3 pb-3"
      >
        <p className="text-muted-foreground text-meta">
          Checked by {verification.model_name} on {when} against{" "}
          {formatPlural(verification.file_ids.length, "file")}. Labels describe
          the sources; they do not change the answer.
          <br />
          {usageSummary(verification)}
        </p>
        {limitNotes(verification).map((note) => (
          <p key={note} className="text-meta">
            {note}
          </p>
        ))}
        {verification.claims.some((claim) => claim.quote) && (
          <label className="text-meta flex w-fit items-center gap-2">
            <Switch
              checked={highlight}
              onCheckedChange={setHighlight}
              aria-label="Highlight claims in the answer"
            />
            Highlight claims in the answer
          </label>
        )}
        {verification.claims.length ? (
          <ol className="flex flex-col gap-2" aria-label="Verified claims">
            {verification.claims.map((claim, index) => (
              <ClaimItem key={index} chatId={chatId} claim={claim} />
            ))}
          </ol>
        ) : (
          <p className="text-sm">The verifier found no factual claims.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ClaimItem({
  chatId,
  claim,
}: {
  chatId: string;
  claim: VerifiedClaim;
}) {
  const { text, Icon, variant } = LABELS[claim.label];
  return (
    <li
      className="border-border rounded-control flex flex-col gap-1.5 border p-2.5"
      data-claim-label={claim.label}
    >
      <div className="flex flex-wrap items-start gap-2">
        <Badge variant={variant} className="shrink-0">
          <Icon aria-hidden data-icon="inline-start" />
          {text}
        </Badge>
        <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
          {claim.claim}
        </span>
      </div>
      {claim.explanation && (
        <p className="text-muted-foreground text-meta [overflow-wrap:anywhere]">
          {claim.explanation}
        </p>
      )}
      {!!claim.evidence?.length && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Evidence">
          {claim.evidence.map((evidence) => (
            <li
              key={`${evidence.file_id}:${evidence.chunk_id}`}
              className="max-w-full min-w-0"
            >
              <EvidenceChip chatId={chatId} evidence={evidence} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const chip =
  "border-border rounded-chip inline-flex h-7 max-w-full items-center gap-1.5 border px-2 text-xs";

function EvidenceChip({
  chatId,
  evidence,
}: {
  chatId: string;
  evidence: ClaimEvidence;
}) {
  const preview = (
    <TooltipContent
      side="top"
      className="max-w-sm flex-col items-start gap-1 text-left"
    >
      <span className="font-medium [overflow-wrap:anywhere]">
        {evidence.name}
      </span>
      <span className="[overflow-wrap:anywhere] whitespace-normal opacity-90">
        “{evidence.excerpt}”
      </span>
      {!evidence.available && (
        <span className="opacity-75">No longer available in this chat</span>
      )}
    </TooltipContent>
  );
  if (!evidence.available)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="note"
            aria-label={`Evidence unavailable: ${evidence.name}`}
            data-evidence="unavailable"
            className={cn(
              chip,
              "text-muted-foreground focus-visible:ring-ring border-dashed outline-none focus-visible:ring-2",
            )}
          >
            <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="max-w-48 truncate line-through">
              {evidence.name}
            </span>
          </span>
        </TooltipTrigger>
        {preview}
      </Tooltip>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={scopedFileHref(chatId, evidence.file_id)}
          aria-label={`Evidence: ${evidence.name}`}
          data-evidence="available"
          className={cn(
            chip,
            "hover:bg-muted focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
          )}
        >
          <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="max-w-48 truncate">{evidence.name}</span>
        </Link>
      </TooltipTrigger>
      {preview}
    </Tooltip>
  );
}
