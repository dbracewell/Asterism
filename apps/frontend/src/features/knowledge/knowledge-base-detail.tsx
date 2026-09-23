"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import { KnowledgeDocument, UserFile } from "@/lib/client";
import {
  fileGetManyOptions,
  fileUploadMutation,
  knowledgeDocumentCancelCaptionMutation,
  knowledgeDocumentCreateMutation,
  knowledgeDocumentDeleteMutation,
  knowledgeDocumentGenerateCaptionMutation,
  knowledgeDocumentGetManyOptions,
  knowledgeDocumentIngestMutation,
  knowledgeDocumentReindexMutation,
  knowledgeDocumentUpdateCaptionMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2, XIcon } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";

type CaptionUpdate = { text?: string; accept?: boolean; clear?: boolean };

export function KnowledgeBaseDetail({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string;
}) {
  const [selectedFileId, setSelectedFileId] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>(
    {},
  );
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const documentsQuery = useQuery({
    ...knowledgeDocumentGetManyOptions({
      client,
      path: { knowledge_base_id: knowledgeBaseId },
      query: { page: 1, page_size: 100 },
    }),
    refetchInterval: 3_000,
  });
  const filesQuery = useQuery(
    fileGetManyOptions({ client, query: { page: 1, page_size: 100 } }),
  );
  const createDocument = useMutation(
    knowledgeDocumentCreateMutation({ client }),
  );
  const ingestDocument = useMutation(
    knowledgeDocumentIngestMutation({ client }),
  );
  const uploadFiles = useMutation(fileUploadMutation({ client }));
  const generateDocumentCaption = useMutation(
    knowledgeDocumentGenerateCaptionMutation({ client }),
  );
  const cancelDocumentCaption = useMutation(
    knowledgeDocumentCancelCaptionMutation({ client }),
  );
  const updateDocumentCaption = useMutation(
    knowledgeDocumentUpdateCaptionMutation({ client }),
  );
  const deleteDocument = useMutation(
    knowledgeDocumentDeleteMutation({ client }),
  );
  const reindexDocument = useMutation(
    knowledgeDocumentReindexMutation({ client }),
  );
  const documents = documentsQuery.data?.documents ?? [];
  const files = filesQuery.data?.files ?? [];
  const queryError =
    documentsQuery.isError || filesQuery.isError
      ? "Unable to load knowledge documents."
      : null;
  const uploading = uploadFiles.isPending;
  const captionBusy = generateDocumentCaption.isPending
    ? generateDocumentCaption.variables.path.document_id
    : cancelDocumentCaption.isPending
      ? cancelDocumentCaption.variables.path.document_id
      : updateDocumentCaption.isPending
        ? updateDocumentCaption.variables.path.document_id
        : null;

  const attach = () => {
    if (!selectedFileId) return;
    createDocument.mutate(
      {
        path: { knowledge_base_id: knowledgeBaseId },
        body: { file_id: selectedFileId },
      },
      {
        onSuccess: (document) => {
          ingestDocument.mutate(
            {
              path: {
                knowledge_base_id: knowledgeBaseId,
                document_id: document.id,
              },
            },
            {
              onSuccess: () => {
                setSelectedFileId("");
                void documentsQuery.refetch();
              },
              onError: () =>
                setError(
                  "Unable to attach this file. It may already be attached.",
                ),
            },
          );
        },
        onError: () =>
          setError("Unable to attach this file. It may already be attached."),
      },
    );
  };

  const uploadAndAttach = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) return;

    uploadFiles.mutate(
      { body: { files: selectedFiles } },
      {
        onSuccess: async (data) => {
          const uploadedFiles = data.files ?? [];
          if (uploadedFiles.length !== selectedFiles.length) {
            setError(
              "Unable to upload and attach all selected files. Files that were uploaded remain available in Files.",
            );
            return;
          }
          try {
            await Promise.all(
              uploadedFiles.map(async (file) => {
                const document = await createDocument.mutateAsync({
                  path: { knowledge_base_id: knowledgeBaseId },
                  body: { file_id: file.id },
                });
                await ingestDocument.mutateAsync({
                  path: {
                    knowledge_base_id: knowledgeBaseId,
                    document_id: document.id,
                  },
                });
              }),
            );
            setError(null);
            void documentsQuery.refetch();
            void filesQuery.refetch();
          } catch {
            setError(
              "Unable to upload and attach all selected files. Files that were uploaded remain available in Files.",
            );
          } finally {
            if (uploadInputRef.current) uploadInputRef.current.value = "";
          }
        },
        onError: () =>
          setError(
            "Unable to upload and attach all selected files. Files that were uploaded remain available in Files.",
          ),
      },
    );
  };

  const generateCaption = (document: KnowledgeDocument) => {
    generateDocumentCaption.mutate(
      {
        path: { knowledge_base_id: knowledgeBaseId, document_id: document.id },
      },
      {
        onSuccess: () => {
          setCaptionDrafts((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([id]) => id !== document.id),
            ),
          );
          setError(null);
          void documentsQuery.refetch();
        },
        onError: () =>
          setError(
            "Caption generation could not be started. Captioning may be disabled or unavailable.",
          ),
      },
    );
  };

  const cancelCaption = (document: KnowledgeDocument) => {
    cancelDocumentCaption.mutate(
      {
        path: { knowledge_base_id: knowledgeBaseId, document_id: document.id },
      },
      {
        onSuccess: () => void documentsQuery.refetch(),
        onError: () => setError("Caption generation could not be canceled."),
      },
    );
  };

  const updateCaption = (document: KnowledgeDocument, body: CaptionUpdate) => {
    updateDocumentCaption.mutate(
      {
        path: { knowledge_base_id: knowledgeBaseId, document_id: document.id },
        body,
      },
      {
        onSuccess: (updatedDocument) => {
          setCaptionDrafts((current) => ({
            ...current,
            [document.id]: updatedDocument.caption.text ?? "",
          }));
          setError(null);
          void documentsQuery.refetch();
        },
        onError: () => setError("Caption changes could not be saved."),
      },
    );
  };

  const remove = (document: KnowledgeDocument) => {
    deleteDocument.mutate(
      {
        path: { knowledge_base_id: knowledgeBaseId, document_id: document.id },
      },
      {
        onSuccess: () => void documentsQuery.refetch(),
        onError: () => setError("Unable to remove this document."),
      },
    );
  };

  const reindex = (document: KnowledgeDocument) => {
    reindexDocument.mutate(
      {
        path: { knowledge_base_id: knowledgeBaseId, document_id: document.id },
      },
      {
        onSuccess: () => void documentsQuery.refetch(),
        onError: () => setError("Unable to reindex this document."),
      },
    );
  };

  return (
    <main className="mx-auto flex h-screen min-h-0 w-full max-w-4xl flex-col gap-6 p-6 pt-12">
      <KnowledgeDocumentsHeader />
      <KnowledgeDocumentUploader
        files={files}
        selectedFileId={selectedFileId}
        uploading={uploading}
        uploadInputRef={uploadInputRef}
        onFileChange={uploadAndAttach}
        onSelectedFileChange={setSelectedFileId}
        onAttach={attach}
      />
      {(error ?? queryError) && (
        <p className="text-destructive" role="alert">
          {error ?? queryError}
        </p>
      )}
      {documents.length === 0 ? (
        <p className="text-muted-foreground">No documents attached yet.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <InputGroup>
            <InputGroupInput
              placeholder="Filter documents by name"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <InputGroupAddon align="inline-end">
              {filter && (
                <Button variant="ghost" size="sm" onClick={() => setFilter("")}>
                  <XIcon />
                </Button>
              )}
            </InputGroupAddon>
          </InputGroup>
          <div className="flex h-0 min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {documents
              .sort((a, b) => a.original_name.localeCompare(b.original_name))
              .filter(
                (document) =>
                  !filter.trim() ||
                  document.original_name
                    .toLowerCase()
                    .includes(filter.trim().toLowerCase()),
              )
              .map((document) => (
                <KnowledgeDocumentCard
                  key={document.id}
                  document={document}
                  captionText={
                    captionDrafts[document.id] ?? document.caption.text ?? ""
                  }
                  captionBusy={captionBusy === document.id}
                  onCaptionDraftChange={(documentId, value) =>
                    setCaptionDrafts((current) => ({
                      ...current,
                      [documentId]: value,
                    }))
                  }
                  onGenerateCaption={generateCaption}
                  onCancelCaption={cancelCaption}
                  onUpdateCaption={updateCaption}
                  onRemove={remove}
                  onReindex={reindex}
                />
              ))}
          </div>
        </div>
      )}
    </main>
  );
}

function KnowledgeDocumentsHeader() {
  return (
    <header>
      <h1 className="text-2xl font-semibold">Knowledge documents</h1>
      <p className="text-muted-foreground">
        Upload one or more files, or attach files you previously uploaded.
        Indexing starts automatically and this page refreshes document status
        every few seconds.
      </p>
    </header>
  );
}

function KnowledgeDocumentUploader({
  files,
  selectedFileId,
  uploading,
  uploadInputRef,
  onFileChange,
  onSelectedFileChange,
  onAttach,
}: {
  files: UserFile[];
  selectedFileId: string;
  uploading: boolean;
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectedFileChange: (fileId: string) => void;
  onAttach: () => void;
}) {
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label="Add knowledge documents"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={uploadInputRef}
          className="sr-only"
          type="file"
          multiple
          aria-label="Upload knowledge files"
          onChange={(event) => void onFileChange(event)}
        />
        <Button
          type="button"
          disabled={uploading}
          onClick={() => uploadInputRef.current?.click()}
        >
          {uploading ? "Uploading and attaching…" : "Upload and attach files"}
        </Button>
        <span className="text-muted-foreground text-sm">
          Select multiple files to upload and add at once.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <select
          className="min-w-64 rounded border bg-transparent p-2"
          value={selectedFileId}
          onChange={(event) => onSelectedFileChange(event.target.value)}
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
          disabled={!selectedFileId || uploading}
          onClick={() => void onAttach()}
        >
          Attach existing file
        </Button>
      </div>
    </section>
  );
}

function KnowledgeDocumentCard({
  document,
  captionText,
  captionBusy,
  onCaptionDraftChange,
  onGenerateCaption,
  onCancelCaption,
  onUpdateCaption,
  onRemove,
  onReindex,
}: {
  document: KnowledgeDocument;
  captionText: string;
  captionBusy: boolean;
  onCaptionDraftChange: (documentId: string, value: string) => void;
  onGenerateCaption: (document: KnowledgeDocument) => void;
  onCancelCaption: (document: KnowledgeDocument) => void;
  onUpdateCaption: (document: KnowledgeDocument, body: CaptionUpdate) => void;
  onRemove: (document: KnowledgeDocument) => void;
  onReindex: (document: KnowledgeDocument) => void;
}) {
  const { confirm, Dialog } = useConfirmationDialog({
    title: "Remove knowledge document?",
    description: `Remove ${document.original_name} from this knowledge base?`,
    confirmVariant: "destructive",
  });
  const captionRunning =
    document.caption.status === "pending" ||
    document.caption.status === "running";

  const handleRemove = async () => {
    if (await confirm()) onRemove(document);
  };

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>{document.original_name}</CardTitle>
        <CardDescription>
          Status: <span className="capitalize">{document.status}</span>
          {document.status === "pending" ? " — queued for indexing" : ""}
          {document.error ? ` — ${document.error}` : ""}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onReindex(document)}
          >
            Reindex
          </Button>
          <Button
            aria-label={`Remove ${document.original_name}`}
            variant="destructiveGhost"
            size="icon"
            onClick={() => void handleRemove()}
          >
            <Trash2 size={16} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {document.mime_type.startsWith("image/") && (
          <ImageCaptionEditor
            document={document}
            captionText={captionText}
            busy={captionBusy}
            captionRunning={captionRunning}
            onCaptionDraftChange={onCaptionDraftChange}
            onGenerateCaption={onGenerateCaption}
            onCancelCaption={onCancelCaption}
            onUpdateCaption={onUpdateCaption}
          />
        )}
      </CardContent>
      <Dialog />
    </Card>
  );
}

function ImageCaptionEditor({
  document,
  captionText,
  busy,
  captionRunning,
  onCaptionDraftChange,
  onGenerateCaption,
  onCancelCaption,
  onUpdateCaption,
}: {
  document: KnowledgeDocument;
  captionText: string;
  busy: boolean;
  captionRunning: boolean;
  onCaptionDraftChange: (documentId: string, value: string) => void;
  onGenerateCaption: (document: KnowledgeDocument) => void;
  onCancelCaption: (document: KnowledgeDocument) => void;
  onUpdateCaption: (document: KnowledgeDocument, body: CaptionUpdate) => void;
}) {
  const { caption } = document;

  return (
    <section
      className="bg-muted/40 space-y-2 rounded-md border p-3"
      aria-label={`Caption for ${document.original_name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Image description{" "}
          {caption.status ? (
            <span className="text-muted-foreground font-normal">
              — {caption.status}
              {caption.source ? ` · ${caption.source}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">
              — not generated
            </span>
          )}
        </p>
        {captionRunning ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void onCancelCaption(document)}
          >
            Cancel generation
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void onGenerateCaption(document)}
          >
            {caption.status === "failed" || caption.status === "canceled"
              ? "Retry caption"
              : caption.status
                ? "Regenerate caption"
                : "Generate caption"}
          </Button>
        )}
      </div>
      {caption.error_reason && (
        <p role="alert" className="text-destructive text-sm">
          {caption.error_reason}
        </p>
      )}
      {(caption.status === "draft" || caption.status === "accepted") && (
        <>
          <Textarea
            aria-label={`Edit caption for ${document.original_name}`}
            value={captionText}
            maxLength={10000}
            onChange={(event) =>
              onCaptionDraftChange(document.id, event.target.value)
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !captionText.trim()}
              onClick={() =>
                void onUpdateCaption(document, {
                  text: captionText,
                  accept: true,
                })
              }
            >
              Accept caption
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void onUpdateCaption(document, { clear: true })}
            >
              Clear caption
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Review before accepting. The image stays indexed visually; accepted
            text improves text retrieval.
          </p>
        </>
      )}
    </section>
  );
}
