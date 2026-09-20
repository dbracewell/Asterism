/* eslint-disable @next/next/no-img-element -- local object URLs cannot be optimized by Next. */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { ConnectionStatus } from "@/features/chat/types";
import { cn } from "@/lib/utils";
import { IconArrowUp, IconCirclePlus, IconPaperclip, IconPlus, IconX } from "@tabler/icons-react";
import React, { useCallback, useRef, useState } from "react";

type UploadState = "queued" | "uploading" | "failed";
const uploadErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "detail" in error && typeof error.detail === "string") return error.detail;
  return "Upload failed. Please retry.";
};
interface AttachedFile {
  id: string;
  name: string;
  file: File;
  preview?: string;
  state: UploadState;
  error?: string;
}

const ChatInput = React.memo(({
  onSubmit,
  status,
  disabled = false,
  placeholder = "",
  onLineNumberChange,
}: {
  onSubmit?: ({ prompt, files }: { prompt: string; files: string[] }) => void;
  disabled?: boolean;
  status?: ConnectionStatus;
  placeholder?: string;
  onLineNumberChange?: (lines: number) => void;
}) => {
  const [prompt, setPrompt] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const numberOfLinesRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: File[]) => {
    const additions = files.map((file) => ({
      id: crypto.randomUUID(), name: file.name, file, state: "queued" as const,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setAttachedFiles((previous) => [...previous, ...additions]);
  }, []);

  const updateFile = (id: string, update: Partial<AttachedFile>) =>
    setAttachedFiles((files) => files.map((file) => file.id === id ? { ...file, ...update } : file));

  const submitPrompt = async () => {
    if (disabled || isSubmitting || !onSubmit || (!prompt.trim() && !attachedFiles.length)) return;
    setIsSubmitting(true);
    const uploads = await Promise.all(attachedFiles.map(async (attachment) => {
      updateFile(attachment.id, { state: "uploading", error: undefined });
      try {
        // This generated client is deliberately used instead of a hand-written fetch.
        const { data } = await api.fileUpload({ body: { files: [attachment.file] } });
        const uploaded = data?.files[0];
        if (!uploaded) throw new Error("The server did not return an uploaded file.");
        return uploaded.filename;
      } catch (error) {
        // This is an expected, user-correctable state. Do not use console.error:
        // Next.js development mode presents those as an application error overlay.
        console.warn("File upload failed", { name: attachment.name, error });
        updateFile(attachment.id, { state: "failed", error: uploadErrorMessage(error) });
        return null;
      }
    }));
    const files = uploads.filter((filename): filename is string => filename !== null);
    setIsSubmitting(false);
    // Do not send a partial set: failed chips remain retryable with the prompt intact.
    if (files.length !== attachedFiles.length) return;
    onSubmit({ prompt: prompt.trim(), files });
    attachedFiles.forEach((file) => file.preview && URL.revokeObjectURL(file.preview));
    setAttachedFiles([]);
    setPrompt("");
  };

  const canSubmit = (!!prompt.trim() || attachedFiles.length > 0) && !disabled && !isSubmitting && (!status || status === "Connected");
  const removeFile = (id: string) => setAttachedFiles((files) => {
    const file = files.find((item) => item.id === id);
    if (file?.preview) URL.revokeObjectURL(file.preview);
    return files.filter((item) => item.id !== id);
  });

  return <div className="mx-auto flex w-full max-w-[80%] flex-col sm:max-w-3xl">
    <div className="bg-input text-foreground relative flex-col content-center overflow-clip rounded-xl border">
      {attachedFiles.length > 0 && <div className="relative flex flex-wrap items-center gap-2 overflow-hidden p-2" aria-live="polite">
        {attachedFiles.map((file) => <Badge className="group relative h-7 max-w-56 px-1 text-[13px]" key={file.id} variant={file.state === "failed" ? "destructive" : "outline"}>
          {file.preview ? <img alt="" className="h-5 w-5 rounded object-cover" src={file.preview} /> : <IconPaperclip size={14} />}
          <span className="truncate px-1">{file.name}</span>
          {file.state === "uploading" && <span className="text-xs">Uploading…</span>}
          {file.state === "failed" && <span className="text-xs">Failed</span>}
          <button aria-label={`Remove ${file.name}`} className="ml-auto rounded-full p-0.5 focus-visible:outline" onClick={() => removeFile(file.id)} type="button"><IconX size={13} /></button>
        </Badge>)}
      </div>}
      {attachedFiles.filter((file) => file.state === "failed").map((file) => <p className="text-destructive px-2 pb-1 text-xs" key={`${file.id}-error`} role="alert">{file.name}: {file.error}</p>)}
      <form className="flex w-full flex-1 flex-col gap-1 overflow-clip rounded-[inherit] p-1" onDragLeave={() => setIsDragOver(false)} onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }} onDrop={(event) => { event.preventDefault(); setIsDragOver(false); addFiles(Array.from(event.dataTransfer.files)); }} onSubmit={(event) => { event.preventDefault(); void submitPrompt(); }}>
        <Textarea aria-label="Message" className={cn("max-h-35 flex-1 resize-none rounded-none border-none bg-transparent! shadow-none focus-visible:border-transparent focus-visible:ring-0", prompt.split(/\r?\n/).length === 1 && "h-6! min-h-6!")} onChange={(event) => { const lines = Math.min(7, event.target.value.split(/\n/).length); if (numberOfLinesRef.current !== lines) { numberOfLinesRef.current = lines; onLineNumberChange?.(lines); } setPrompt(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSubmit) void submitPrompt(); } }} placeholder={placeholder} value={prompt} />
        <div className="flex items-center justify-between px-1">
          <><input aria-label="Choose attachments" className="sr-only" multiple onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} ref={fileInputRef} type="file" /><Button aria-label="Add attachments" className="rounded-full" onClick={() => fileInputRef.current?.click()} size="icon" type="button" variant="ghost"><IconPlus /></Button></>
          <div className="flex items-center gap-3">{status && <span className="text-xs">{status}</span>}<Button aria-label="Send message" className={cn("shrink-0 rounded-xl", !canSubmit && "hidden")} disabled={!canSubmit} size="icon" type="submit"><IconArrowUp size={16} /></Button></div>
        </div>
        <div className={cn("border-border bg-muted text-foreground pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border border-dashed text-sm", isDragOver ? "opacity-100" : "opacity-0")}><IconCirclePlus className="mr-1" size={16} />Drop files here to add as attachments</div>
      </form>
    </div>
  </div>;
});
ChatInput.displayName = "ChatInput";
export default ChatInput;
