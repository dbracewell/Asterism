"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { client } from "@/lib/api";
import {
  fileGetManyOptions,
  fileUploadMutation,
  knowledgeBaseFileCreateMutation,
  knowledgeBaseFileGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";

export function KnowledgeBaseDetail({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string;
}) {
  const [selectedFileId, setSelectedFileId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const memberships = useQuery({
    ...knowledgeBaseFileGetManyOptions({
      client,
      path: { knowledge_base_id: knowledgeBaseId },
      query: { page: 1, page_size: 100 },
    }),
  });
  const library = useQuery(
    fileGetManyOptions({ client, query: { page: 1, page_size: 100 } }),
  );
  const attach = useMutation(knowledgeBaseFileCreateMutation({ client }));
  const upload = useMutation(fileUploadMutation({ client }));
  const files = library.data?.files ?? [];
  const fileNames = new Map(files.map((file) => [file.id, file]));
  const add = (fileId = selectedFileId) => {
    if (!fileId) return;
    attach.mutate(
      {
        path: { knowledge_base_id: knowledgeBaseId },
        body: { file_id: fileId },
      },
      {
        onSuccess: () => {
          setSelectedFileId("");
          setError(null);
          void memberships.refetch();
        },
        onError: () =>
          setError(
            "Unable to add this file. It may already be in this collection.",
          ),
      },
    );
  };
  const uploadAndAdd = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (!selected.length) return;
    upload.mutate(
      { body: { files: selected } },
      {
        onSuccess: async ({ files: uploaded = [] }) => {
          try {
            await Promise.all(
              uploaded.map((file) =>
                attach.mutateAsync({
                  path: { knowledge_base_id: knowledgeBaseId },
                  body: { file_id: file.id },
                }),
              ),
            );
            setError(null);
            void memberships.refetch();
            void library.refetch();
          } catch {
            setError(
              "Files were uploaded, but one or more could not be added to this collection.",
            );
          } finally {
            if (input.current) input.current.value = "";
          }
        },
        onError: () => setError("Unable to upload files."),
      },
    );
  };
  return (
    <main className="mx-auto flex h-screen min-h-0 w-full max-w-4xl flex-col gap-6 p-6 pt-12">
      <header>
        <h1 className="text-2xl font-semibold">Knowledge base files</h1>
        <p className="text-muted-foreground">
          This collection references files in your library. Processing and
          captions belong to each file, not this knowledge base.
        </p>
      </header>
      <section
        className="space-y-3 rounded-lg border p-4"
        aria-label="Add knowledge base files"
      >
        <input
          ref={input}
          className="sr-only"
          type="file"
          multiple
          aria-label="Upload knowledge files"
          onChange={(event) => void uploadAndAdd(event)}
        />
        <Button
          type="button"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? "Uploading…" : "Upload and add files"}
        </Button>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <select
            className="min-w-64 rounded border bg-transparent p-2"
            value={selectedFileId}
            onChange={(event) => setSelectedFileId(event.target.value)}
            aria-label="Uploaded file"
          >
            <option value="">Select an uploaded file</option>
            {files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.original_name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            disabled={!selectedFileId || attach.isPending}
            onClick={() => add()}
          >
            Add existing file
          </Button>
        </div>
      </section>
      {(error || memberships.isError || library.isError) && (
        <p className="text-destructive" role="alert">
          {error ?? "Unable to load knowledge-base files."}
        </p>
      )}
      {(memberships.data?.files ?? []).length === 0 ? (
        <p className="text-muted-foreground">
          No files in this knowledge base yet.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {(memberships.data?.files ?? []).map((membership) => {
            const file = fileNames.get(membership.file_id);
            return (
              <Card key={membership.id} className="shrink-0 border">
                <CardHeader>
                  <CardTitle>{file?.original_name ?? "Library file"}</CardTitle>
                  <CardDescription>
                    {file
                      ? `${file.mime_type} · ${file.content_status}`
                      : "File metadata is unavailable."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">
                  Manage processing, captions, and deletion in Files.
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
