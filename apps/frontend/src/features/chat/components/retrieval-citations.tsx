"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/api";
import type { ToolResult } from "@/lib/client";
import { chatFileGetInfoOptions } from "@/lib/client/@tanstack/react-query.gen";
import { Badge } from "@/components/ui/badge";
import { QueryError } from "@/components/query-error";
import Link from "next/link";
import { scopedFileHref } from "./chat-file-context";
const hitSchema = z.object({
  file_id: z.uuid(),
  sources: z.array(z.enum(["project", "chat"])),
  artifact_generation: z.number().int().positive(),
  chunk_id: z.string(),
  score: z.number(),
  match_kind: z.string(),
});
const response = z.object({ results: z.array(hitSchema).max(100) });
export function retrievalCitations(results: ToolResult[]) {
  return results.flatMap((result) => {
    if (result.tool_call.function.name !== "search_knowledge") return [];
    const parsed = response.safeParse(result.raw_result);
    return parsed.success ? parsed.data.results : [];
  });
}
export function RetrievalCitations({
  chatId,
  results,
}: {
  chatId: string;
  results: ToolResult[];
}) {
  const [visible, setVisible] = useState(20);
  const hits = retrievalCitations(results);
  const unique = [
    ...new Map(
      hits.map((item) => [
        `${item.file_id}:${item.artifact_generation}:${item.sources.join()}`,
        item,
      ]),
    ).values(),
  ];
  if (!unique.length) return null;
  return (
    <section
      aria-label="Retrieved sources"
      className="flex flex-col gap-2 py-2 text-xs"
    >
      <h3 className="font-medium">Retrieved sources</h3>
      {unique.slice(0, visible).map((item, index) => (
        <Citation key={index} chatId={chatId} hit={item} />
      ))}
      {unique.length > visible && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setVisible(visible + 20)}
        >
          Show more sources
        </Button>
      )}
    </section>
  );
}
function Citation({
  chatId,
  hit,
}: {
  chatId: string;
  hit: z.infer<typeof hitSchema>;
}) {
  const file = useQuery({
    ...chatFileGetInfoOptions({
      client,
      path: { chat_id: chatId, file_id: hit.file_id },
    }),
    staleTime: 0,
    retry: false,
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {file.error ? (
        <QueryError
          error={file.error}
          message="Retrieved source unavailable in current chat scope."
          retry={file.refetch}
          isRetrying={file.isFetching}
        />
      ) : file.isPending || file.isFetching ? (
        <span role="status">Checking source…</span>
      ) : (
        <Link
          className="break-all underline"
          href={scopedFileHref(chatId, hit.file_id)}
        >
          {file.data.original_name}
        </Link>
      )}
      <Badge variant="outline">
        At retrieval:{" "}
        {hit.sources
          .map((source) => (source === "project" ? "Project" : "This chat"))
          .join(" + ")}
      </Badge>
      <span>
        Generation {hit.artifact_generation} · {hit.match_kind}
      </span>
    </div>
  );
}
