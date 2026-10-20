"use client";

import { Badge } from "@/components/ui/badge";
import { QueryError } from "@/components/query-error";
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
import Link from "next/link";
import type { FileKnowledgeArtifact, FileProjectSummary } from "@/lib/client";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

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
  projects,
  initialData,
  canRegenerate = true,
}: {
  filename: string;
  projects: FileProjectSummary[];
  initialData?: FileKnowledgeArtifact | null;
  canRegenerate?: boolean;
}) {
  const { data, error, isFetching, refetch } = useQuery({
    ...fileKnowledgeGetStatusOptions({ client, path: { filename } }),
    initialData: initialData ?? undefined,
    staleTime: initialData && !isActive(initialData) ? 30_000 : 0,
    // No push channel exists; poll only while work is in flight.
    refetchInterval: (query) =>
      isActive(query.state.data) ? POLL_INTERVAL_MS : false,
  });
  const regenerate = useMutation({
    ...fileKnowledgeRegenerateMutation({ client }),
    onSuccess: () => {
      void refetch();
    },
    onError: () => toast.error("Unable to regenerate embedding and caption."),
  });
  const captionStatus = data?.caption.status ?? "none";
  const busy = regenerate.isPending || isActive(data);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:[overflow-wrap:anywhere] [&_[data-slot=badge]]:whitespace-normal">
      {error && (
        <QueryError
          error={error}
          message="Unable to load file processing status."
          retry={refetch}
          isRetrying={isFetching}
        />
      )}
      {!data && !error && <span role="status">Loading processing status…</span>}
      {data && (
        <>
          <Badge variant={variantFor(data.status)}>
            Embedding: {data.status}
          </Badge>
          <Badge variant={variantFor(captionStatus)}>
            Caption: {captionStatus}
          </Badge>
          {canRegenerate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Regenerate embedding and caption"
                  onClick={() => regenerate.mutate({ path: { filename } })}
                  disabled={busy || !!error}
                >
                  <RotateCcw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Regenerate embedding and caption</TooltipContent>
            </Tooltip>
          )}
        </>
      )}
      {projects.map((project) => (
        <Badge variant="outline" key={project.id} asChild>
          <Link href={`/projects/${project.id}`}>{project.name}</Link>
        </Badge>
      ))}
    </div>
  );
}
