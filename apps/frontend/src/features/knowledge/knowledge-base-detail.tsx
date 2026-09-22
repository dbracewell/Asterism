"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [captionBusy, setCaptionBusy] = useState<string | null>(null);
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
  const replaceDocument = (updated: KnowledgeDocument) => {
    setDocuments((current) => current.map((document) => (document.id === updated.id ? updated : document)));
  };
  const generateCaption = async (document: KnowledgeDocument) => {
    setCaptionBusy(document.id);
    try {
      const { data } = await api.knowledgeDocumentGenerateCaption({
        path: { knowledge_base_id: knowledgeBaseId, document_id: document.id },
      });
      if (data) replaceDocument(data);
      setError(null);
    } catch {
      setError("Caption generation could not be started. Captioning may be disabled or unavailable.");
    } finally { setCaptionBusy(null); }
  };
  const cancelCaption = async (document: KnowledgeDocument) => {
    setCaptionBusy(document.id);
    try {
      const { data } = await api.knowledgeDocumentCancelCaption({ path: { knowledge_base_id: knowledgeBaseId, document_id: document.id } });
      if (data) replaceDocument(data);
    } catch { setError("Caption generation could not be canceled."); } finally { setCaptionBusy(null); }
  };
  const updateCaption = async (document: KnowledgeDocument, body: { text?: string; accept?: boolean; clear?: boolean }) => {
    setCaptionBusy(document.id);
    try {
      const { data } = await api.knowledgeDocumentUpdateCaption({
        path: { knowledge_base_id: knowledgeBaseId, document_id: document.id }, body,
      });
      if (data) {
        replaceDocument(data);
        setCaptionDrafts((current) => ({ ...current, [document.id]: data.caption.text ?? "" }));
      }
      setError(null);
    } catch { setError("Caption changes could not be saved."); } finally { setCaptionBusy(null); }
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
      {documents.map((document) => {
        const isImage = document.mime_type.startsWith("image/");
        const caption = document.caption;
        const captionText = captionDrafts[document.id] ?? caption.text ?? "";
        const captionRunning = caption.status === "pending" || caption.status === "running";
        const busy = captionBusy === document.id;
        return <article className="space-y-3 p-4" key={document.id}>
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="font-medium">{document.original_name}</h2><p className="text-muted-foreground text-sm">Status: <span className="capitalize">{document.status}</span>{document.status === "pending" ? " — queued for indexing" : ""}{document.error ? ` — ${document.error}` : ""}</p></div>
            <div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => void reindex(document)}>Reindex</Button><Button aria-label={`Remove ${document.original_name}`} variant="ghost" size="icon" onClick={() => void remove(document)}><Trash2 size={16} /></Button></div>
          </div>
          {isImage && <section className="space-y-2 rounded-md bg-muted/40 p-3" aria-label={`Caption for ${document.original_name}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Image description {caption.status ? <span className="font-normal text-muted-foreground">— {caption.status}{caption.source ? ` · ${caption.source}` : ""}</span> : <span className="font-normal text-muted-foreground">— not generated</span>}</p>
              {captionRunning ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancelCaption(document)}>Cancel generation</Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void generateCaption(document)}>{caption.status === "failed" || caption.status === "canceled" ? "Retry caption" : caption.status ? "Regenerate caption" : "Generate caption"}</Button>}</div>
            {caption.error_reason && <p role="alert" className="text-sm text-destructive">{caption.error_reason}</p>}
            {(caption.status === "draft" || caption.status === "accepted") && <>
              <Textarea aria-label={`Edit caption for ${document.original_name}`} value={captionText} maxLength={10000} onChange={(event) => setCaptionDrafts((current) => ({ ...current, [document.id]: event.target.value }))} />
              <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !captionText.trim()} onClick={() => void updateCaption(document, { text: captionText, accept: true })}>Accept caption</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void updateCaption(document, { clear: true })}>Clear caption</Button></div>
              <p className="text-xs text-muted-foreground">Review before accepting. The image stays indexed visually; accepted text improves text retrieval.</p>
            </>}
          </section>}
        </article>;
      })}
    </div>}
  </main>;
}
