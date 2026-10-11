"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { client } from "@/lib/api";
import {
  fileKnowledgeGetStatusOptions,
  fileKnowledgeRegenerateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Library, RotateCcw } from "lucide-react";

type BadgeVariant = "secondary" | "destructive" | "outline";

const variantFor = (status: string): BadgeVariant => {
  if (status === "failed") return "destructive";
  if (status === "ready" || status === "accepted") return "secondary";
  return "outline";
};

const POLL_INTERVAL_MS = 2000;

const isActive = (artifact?: {
  status: string;
  caption: { status?: string | null };
}) =>
  artifact?.status === "pending" ||
  artifact?.status === "processing" ||
  artifact?.caption.status === "pending" ||
  artifact?.caption.status === "running";

export function KnowledgeStatus({
  filename,
  knowledgeBaseCount,
}: {
  filename: string;
  knowledgeBaseCount: number;
}) {
  const { data } = useQuery({
    ...fileKnowledgeGetStatusOptions({ client, path: { filename } }),
    // No push channel exists; poll only while work is in flight.
    refetchInterval: (query) =>
      isActive(query.state.data) ? POLL_INTERVAL_MS : false,
  });
  const regenerate = useMutation(fileKnowledgeRegenerateMutation({ client }));
  if (!data) return null;
  const captionStatus = data.caption.status ?? "none";
  const busy =
    regenerate.isPending ||
    data.status === "pending" ||
    data.status === "processing";
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <Badge variant={variantFor(data.status)}>Embedding: {data.status}</Badge>
      <Badge variant={variantFor(captionStatus)}>Caption: {captionStatus}</Badge>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Regenerate embedding and caption"
            onClick={() => regenerate.mutate({ path: { filename } })}
            disabled={busy}
          >
            <RotateCcw />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Regenerate embedding and caption</TooltipContent>
      </Tooltip>
      {knowledgeBaseCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label="In a knowledge base"
              className="text-muted-foreground inline-flex"
            >
              <Library className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            In {knowledgeBaseCount} knowledge{" "}
            {knowledgeBaseCount === 1 ? "base" : "bases"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
