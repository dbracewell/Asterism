"use client";

import * as FileManager from "@/components/file-manager";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import { knowledgeBaseGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";

export function KnowledgeBaseDetail({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string;
}) {
  const router = useRouter();
  const {
    data: kb,
    isPending,
    error,
    isFetching,
    refetch,
  } = useQuery(
    knowledgeBaseGetOneOptions({
      client,
      path: { knowledge_base_id: knowledgeBaseId },
    }),
  );
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="bg-accent text-accent-foreground flex items-center gap-2 border-b py-2 pr-4 pl-2 text-lg font-bold">
        <Hint hint="Back" asChild>
          <Button
            aria-label="Back"
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
          >
            <ArrowLeftIcon />
          </Button>
        </Hint>
        <div className="flex flex-col">
          <h3>{kb ? `Knowledge Base: ${kb.name}` : "Knowledge Base"}</h3>
          <p className="text-muted-foreground text-sm">
            {kb?.description ?? ""}
          </p>
        </div>
      </header>
      {isPending ? (
        <Spinner loadingMessage />
      ) : error ? (
        <QueryError
          error={error}
          message="Unable to load knowledge base."
          retry={refetch}
          isRetrying={isFetching}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <FileManager.Provider knowledgeBaseId={knowledgeBaseId}>
            <FileManager.Ribbon>
              <FileManager.KnowledgeBaseSection
                knowledgeBaseId={knowledgeBaseId}
              />
            </FileManager.Ribbon>
            <FileManager.FileList />
          </FileManager.Provider>
        </div>
      )}
    </main>
  );
}
