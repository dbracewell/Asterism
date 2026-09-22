"use client";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { KnowledgeDocument, UserFile } from "@/lib/client";
import { Trash2 } from "lucide-react";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

export function KnowledgeBaseDetail({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [files, setFiles] = useState<UserFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [documentsResponse, filesResponse] = await Promise.all([
        api.knowledgeDocumentGetMany({ path: { knowledge_base_id: knowledgeBaseId }, query: { page: 1, page_size: 100 } }),
        api.fileGetMany({ query: { page: 1, page_size: 100 } }),
      ]);
      setDocuments(documentsResponse.data?.documents ?? []);
      setFiles(filesResponse.data?.files ?? []);
      setError(null);
    } catch {
      setError("Unable to load knowledge documents.");
    }
  }, [knowledgeBaseId]);

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const attach = async () => {
    if (!selectedFileId) return;
    try {
      const { data } = await api.knowledgeDocumentCreate({
        path: { knowledge_base_id: knowledgeBaseId },
        body: { file_id: selectedFileId },
      });
      if (!data) throw new Error("The document could not be created.");
      await api.knowledgeDocumentIngest({
        path: { knowledge_base_id: knowledgeBaseId, document_id: data.id },
      });
      setSelectedFileId("");
      await load();
    } catch { setError("Unable to attach this file. It may already be attached."); }
  };
  const uploadAndAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) return;
    setUploading(true);
    try {
      const { data } = await api.fileUpload({ body: { files: selectedFiles } });
      const uploadedFiles = data?.files ?? [];
      if (uploadedFiles.length !== selectedFiles.length) {
        throw new Error("One or more selected files could not be uploaded.");
      }
      await Promise.all(
        uploadedFiles.map(async (file) => {
          const { data: document } = await api.knowledgeDocumentCreate({
            path: { knowledge_base_id: knowledgeBaseId },
            body: { file_id: file.id },
          });
          if (!document) throw new Error("The document could not be created.");
          await api.knowledgeDocumentIngest({
            path: { knowledge_base_id: knowledgeBaseId, document_id: document.id },
          });
        }),
      );
      setError(null);
      await load();
    } catch {
      setError("Unable to upload and attach all selected files. Files that were uploaded remain available in Files.");
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };
  const remove = async (document: KnowledgeDocument) => {
    if (!window.confirm(`Remove ${document.original_name} from this knowledge base?`)) return;
    try {
      await api.knowledgeDocumentDelete({ path: { knowledge_base_id: knowledgeBaseId, document_id: document.id } });
      await load();
    } catch { setError("Unable to remove this document."); }
  };
  const reindex = async (document: KnowledgeDocument) => {
    try {
      await api.knowledgeDocumentReindex({ path: { knowledge_base_id: knowledgeBaseId, document_id: document.id } });
      await load();
    } catch { setError("Unable to reindex this document."); }
  };

  return <main className="mx-auto mt-12 w-full max-w-4xl space-y-6 p-6">
    <header><h1 className="text-2xl font-semibold">Knowledge documents</h1><p className="text-muted-foreground">Upload one or more files, or attach files you previously uploaded. Indexing starts automatically and this page refreshes document status every few seconds.</p></header>
    <section className="space-y-3 rounded-lg border p-4" aria-label="Add knowledge documents">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={uploadInputRef} className="sr-only" type="file" multiple aria-label="Upload knowledge files" onChange={(event) => void uploadAndAttach(event)} />
        <Button type="button" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>{uploading ? "Uploading and attaching…" : "Upload and attach files"}</Button>
        <span className="text-muted-foreground text-sm">Select multiple files to upload and add at once.</span>
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <select className="min-w-64 rounded border bg-transparent p-2" value={selectedFileId} onChange={(event) => setSelectedFileId(event.target.value)} aria-label="Uploaded file">
          <option value="">Select an uploaded file</option>{files.map((file) => <option key={file.id} value={file.id}>{file.original_name}</option>)}
        </select><Button type="button" disabled={!selectedFileId || uploading} onClick={() => void attach()}>Attach existing file</Button>
      </div>
    </section>
    {error && <p className="text-destructive" role="alert">{error}</p>}
    {documents.length === 0 ? <p className="text-muted-foreground">No documents attached yet.</p> : <div className="divide-y rounded-lg border">
      {documents.map((document) => <article className="flex items-center justify-between gap-4 p-4" key={document.id}>
        <div><h2 className="font-medium">{document.original_name}</h2><p className="text-muted-foreground text-sm">Status: <span className="capitalize">{document.status}</span>{document.status === "pending" ? " — queued for indexing" : ""}{document.error ? ` — ${document.error}` : ""}</p></div>
        <div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => void reindex(document)}>Reindex</Button><Button aria-label={`Remove ${document.original_name}`} variant="ghost" size="icon" onClick={() => void remove(document)}><Trash2 size={16} /></Button></div>
      </article>)}
    </div>}
  </main>;
}
