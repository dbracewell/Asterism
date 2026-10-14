"use client";

import * as FileManager from "@/components/file-manager";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
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
  const { data: kb } = useQuery(
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
          <h3>Knowledge Base: {kb?.name ?? ""}</h3>
          <p className="text-muted-foreground text-sm">
            {kb?.description ?? ""}
          </p>
        </div>
      </header>
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
    </main>
  );
}
