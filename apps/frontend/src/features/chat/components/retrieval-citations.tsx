"use client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { client } from "@/lib/api";
import type { ToolResult } from "@/lib/client";
import { chatFileGetInfoOptions } from "@/lib/client/@tanstack/react-query.gen";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { FileTextIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { scopedFileHref } from "./chat-file-context";

const hitSchema = z.object({
  file_id: z.uuid(),
  sources: z.array(z.enum(["project", "chat"])),
  artifact_generation: z.number().int().positive(),
  chunk_id: z.string(),
  score: z.number(),
  match_kind: z.string(),
  excerpt: z.string().optional(),
});
const response = z.object({ results: z.array(hitSchema).max(100) });

type Hit = z.infer<typeof hitSchema>;

/** One cited file: its best (first) hit and how many passages matched. */
export type CitedSource = { hit: Hit; passages: number };

const PAGE = 20;
const PREVIEW_LENGTH = 280;

export function retrievalCitations(results: ToolResult[]) {
  return results.flatMap((result) => {
    if (result.tool_call.function.name !== "search_knowledge") return [];
    const parsed = response.safeParse(result.raw_result);
    return parsed.success ? parsed.data.results : [];
  });
}

/** Hits grouped by file in first-retrieval order; numbers follow this order. */
export function citedSources(results: ToolResult[]): CitedSource[] {
  const sources = new Map<string, CitedSource>();
  for (const hit of retrievalCitations(results)) {
    const cited = sources.get(hit.file_id);
    if (cited) cited.passages += 1;
    else sources.set(hit.file_id, { hit, passages: 1 });
  }
  return [...sources.values()];
}

export function previewExcerpt(excerpt: string | undefined): string | null {
  const text = excerpt?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH - 1)}…`
    : text;
}

const scopeLabel = (hit: Hit) =>
  hit.sources
    .map((source) => (source === "project" ? "Project" : "This chat"))
    .join(" + ");

const chipClass =
  "border-border bg-card text-card-foreground rounded-chip inline-flex h-7 max-w-full items-center gap-1.5 border pr-2.5 pl-1 text-xs";

const Ordinal = ({ value }: { value: number }) => (
  <span
    aria-hidden="true"
    className="bg-muted text-foreground rounded-chip inline-flex h-5 min-w-5 shrink-0 items-center justify-center px-1 font-mono text-[0.6875rem] font-medium tabular-nums"
  >
    {value}
  </span>
);

/**
 * Retrieved sources as numbered chips. Each chip links to the scoped file view
 * only after the file is confirmed in the current chat scope, and previews the
 * matched excerpt on hover or focus. Excerpts and names are untrusted text.
 */
export function RetrievalCitations({
  chatId,
  results,
}: {
  chatId: string;
  results: ToolResult[];
}) {
  const [visible, setVisible] = useState(PAGE);
  const sources = citedSources(results);
  if (!sources.length) return null;
  return (
    <section
      aria-label="Retrieved sources"
      className="flex min-w-0 flex-col gap-1.5 py-2"
    >
      <h3 className="text-muted-foreground text-meta font-medium">Sources</h3>
      <ol className="flex min-w-0 flex-wrap gap-1.5">
        {sources.slice(0, visible).map((source, index) => (
          <li key={source.hit.file_id} className="max-w-full min-w-0">
            <SourceChip chatId={chatId} number={index + 1} source={source} />
          </li>
        ))}
      </ol>
      {sources.length > visible && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => setVisible(visible + PAGE)}
        >
          Show {Math.min(PAGE, sources.length - visible)} more sources
        </Button>
      )}
    </section>
  );
}

function SourceChip({
  chatId,
  number,
  source,
}: {
  chatId: string;
  number: number;
  source: CitedSource;
}) {
  const { hit, passages } = source;
  const file = useQuery({
    ...chatFileGetInfoOptions({
      client,
      path: { chat_id: chatId, file_id: hit.file_id },
    }),
    staleTime: 0,
    retry: false,
  });

  if (file.error) {
    return (
      <span
        data-state="unavailable"
        className={cn(chipClass, "text-muted-foreground border-dashed pr-0.5")}
      >
        <Ordinal value={number} />
        <span role="alert" className="truncate">
          Source unavailable in this chat
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Retry source ${number}`}
          disabled={file.isFetching}
          onClick={() => void file.refetch()}
        >
          <RotateCwIcon
            className={cn(
              file.isFetching && "animate-spin motion-reduce:animate-none",
            )}
          />
        </Button>
      </span>
    );
  }

  if (file.isPending) {
    return (
      <span role="status" data-state="checking" className={chipClass}>
        <Ordinal value={number} />
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
        Checking source…
      </span>
    );
  }

  const name = file.data.original_name;
  const excerpt = previewExcerpt(hit.excerpt);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={scopedFileHref(chatId, hit.file_id)}
          aria-label={`Source ${number}: ${name}`}
          data-state="available"
          className={cn(
            chipClass,
            "hover:bg-muted focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
          )}
        >
          <Ordinal value={number} />
          <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="max-w-48 truncate">{name}</span>
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
          {scopeLabel(hit)} · generation {hit.artifact_generation} ·{" "}
          {hit.match_kind}
          {passages > 1 && ` · ${formatPlural(passages, "passage")}`}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
