"use client";

import { FileManager } from "@/components/file-manager";
import { AddFilesDialog } from "@/features/knowledge/add-files-dialog";

export function KnowledgeBaseDetail({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string;
}) {
  return (
    <main className="mx-auto flex h-screen min-h-0 w-full max-w-5xl flex-col gap-6 p-6 pt-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge base files</h1>
          <p className="text-muted-foreground">
            This collection references files in your library. Processing and
            captions belong to each file, not this knowledge base. Removing a
            file here keeps it in your library with its derived knowledge.
          </p>
        </div>
        <AddFilesDialog knowledgeBaseId={knowledgeBaseId} />
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <FileManager knowledgeBaseId={knowledgeBaseId} />
      </div>
    </main>
  );
}
