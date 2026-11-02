"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { scopedFileHref } from "@/features/chat/components/chat-file-context";
import type { SpanCitation } from "@/lib/client";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useContext } from "react";
import { InlineFilesContext } from "./inline-files";

const PREVIEW_LENGTH = 400;

const marker =
  "rounded-chip ml-0.5 inline-flex h-4 min-w-4 items-center justify-center px-1 align-super font-mono text-[0.625rem] leading-none font-medium tabular-nums no-underline";

const preview = (excerpt?: string | null) => {
  const text = excerpt?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH - 1)}…`
    : text;
};

/**
 * A claim with its citation markers (ADR-0040). The keys in the text grant
 * nothing: each marker looks its key up in the message's server-resolved list.
 * Available markers link to the scoped file view and preview the cited chunk;
 * everything else is an inert marker. Names and excerpts are untrusted text.
 */
export function CitedClaim({
  keys,
  children,
}: {
  keys: string[];
  children: React.ReactNode;
}) {
  const { chatId, citations = [] } = useContext(InlineFilesContext);
  return (
    <span data-citation-claim="">
      <span className="decoration-muted-foreground/60 underline decoration-dotted underline-offset-4">
        {children}
      </span>
      {keys.map((key) => {
        if (citations === null)
          return (
            <span
              key={key}
              data-citation="pending"
              className={cn(marker, "bg-muted text-muted-foreground")}
            >
              <span aria-hidden="true">…</span>
              <span className="sr-only">Citation pending</span>
            </span>
          );
        const index = citations.findIndex((entry) => entry.key === key);
        const citation = index >= 0 ? citations[index] : undefined;
        return chatId && citation?.available && citation.file_id ? (
          <CitationMarker
            key={key}
            chatId={chatId}
            number={index + 1}
            citation={citation}
          />
        ) : (
          <UnavailableMarker key={key} number={index >= 0 ? index + 1 : null} />
        );
      })}
    </span>
  );
}

function CitationMarker({
  chatId,
  number,
  citation,
}: {
  chatId: string;
  number: number;
  citation: SpanCitation;
}) {
  const name = citation.name || "File";
  const excerpt = preview(citation.excerpt);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={scopedFileHref(chatId, citation.file_id!)}
          aria-label={`Citation ${number}: ${name}`}
          data-citation="available"
          className={cn(
            marker,
            "bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
          )}
        >
          {number}
        </Link>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-sm flex-col items-start gap-1 text-left"
      >
        <span className="font-medium [overflow-wrap:anywhere]">{name}</span>
        {excerpt && (
          <span className="[overflow-wrap:anywhere] whitespace-normal opacity-90">
            “{excerpt}”
          </span>
        )}
        <span className="opacity-75">
          generation {citation.artifact_generation} · {citation.match_kind}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function UnavailableMarker({ number }: { number: number | null }) {
  const label = number
    ? `Citation ${number} unavailable`
    : "Citation unavailable";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="note"
          aria-label={label}
          data-citation="unavailable"
          className={cn(
            marker,
            "text-muted-foreground border-border focus-visible:ring-ring border border-dashed outline-none focus-visible:ring-2",
          )}
        >
          {number ?? "?"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        Source unavailable in this chat
      </TooltipContent>
    </Tooltip>
  );
}
