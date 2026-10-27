"use client";

import { QueryError } from "@/components/query-error";
import { APIImage } from "@/components/api-image";
import { Badge } from "@/components/ui/badge";
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
  fileGetFileInfoOptions,
  fileKnowledgeGetStatusOptions,
  fileSimilarGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatFileSize } from "@/lib/formatters";
import { extractionOf, extractionStatus } from "@/lib/knowledge";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const fileHref = (filename: string) => `/files/${encodeURIComponent(filename)}`;

export function FileView({ filename }: { filename: string }) {
  const path = { filename };
  const info = useQuery(fileGetFileInfoOptions({ client, path }));
  const knowledge = useQuery(fileKnowledgeGetStatusOptions({ client, path }));
  const similar = useQuery(fileSimilarGetManyOptions({ client, path }));
  const router = useRouter();

  if (info.error) {
    return (
      <p className="text-destructive p-6" role="alert">
        This file could not be found.
      </p>
    );
  }
  if (!info.data) return <p className="text-muted-foreground p-6">Loading…</p>;

  const file = info.data;
  const artifact = knowledge.data;
  const captionText = extractionOf(artifact?.extractions, "captioning")?.payload
    ?.text;
  const extractedContent = extractionOf(
    artifact?.extractions,
    "text_extraction",
  )?.payload?.content;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        onClick={() => router.back()}
      >
        <ArrowLeft />
        Back
      </Button>
      <header className="flex items-start gap-4">
        {file.kind === "image" && (
          <APIImage
            className="rounded-control shrink-0 object-cover"
            filename={file.filename}
            alt={file.original_name}
            thumbnail={file.thumbnail}
            width={96}
            height={96}
          />
        )}
        <div className="min-w-0">
          <h1 className="text-title truncate">{file.original_name}</h1>
          <p className="text-muted-foreground text-sm capitalize">
            {file.kind} · {file.mime_type} ·{" "}
            {formatFileSize(file.size, 2, false)}
          </p>
          {artifact && (
            <div className="mt-2 flex gap-1">
              <Badge variant="outline">
                Embedding: {extractionStatus(artifact.extractions, "embedding")}
              </Badge>
              <Badge variant="outline">
                Caption: {extractionStatus(artifact.extractions, "captioning")}
              </Badge>
            </div>
          )}
        </div>
      </header>

      {knowledge.error && (
        <QueryError
          error={knowledge.error}
          message="Unable to load file processing artifacts."
          retry={knowledge.refetch}
          isRetrying={knowledge.isFetching}
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Caption</CardTitle>
        </CardHeader>
        <CardContent>
          {knowledge.isPending ? (
            <p role="status">Loading caption…</p>
          ) : knowledge.error && !artifact ? null : captionText ? (
            <p>{captionText}</p>
          ) : (
            <p className="text-muted-foreground">No caption.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extracted content</CardTitle>
        </CardHeader>
        <CardContent>
          {knowledge.isPending ? (
            <p role="status">Loading content…</p>
          ) : knowledge.error && !artifact ? null : extractedContent ? (
            <pre className="bg-muted rounded-surface max-h-96 overflow-auto p-3 text-sm whitespace-pre-wrap">
              {extractedContent}
            </pre>
          ) : (
            <p className="text-muted-foreground">
              {artifact?.status === "ready"
                ? "This file has no extracted text."
                : "Content is not available until processing is ready."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Similar files</CardTitle>
          <CardDescription>
            The five most similar files in your library.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {similar.error && (
            <QueryError
              error={similar.error}
              message="Unable to load similar files."
              retry={similar.refetch}
              isRetrying={similar.isFetching}
            />
          )}
          {similar.isPending ? (
            <p role="status">Loading similar files…</p>
          ) : similar.error && !similar.data ? null : similar.data?.files
              .length ? (
            <ul className="divide-y">
              {similar.data.files.map(({ file: other, score }) => (
                <li
                  key={other.id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <Link
                    className="truncate underline"
                    href={fileHref(other.filename)}
                  >
                    {other.original_name}
                  </Link>
                  <Badge variant="secondary">{score.toFixed(3)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No similar files.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent>
          {file.projects?.length ? (
            <ul className="divide-y">
              {file.projects.map((base) => (
                <li key={base.id} className="py-2">
                  <Link className="underline" href={`/projects/${base.id}`}>
                    {base.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              This file is not in any project.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
