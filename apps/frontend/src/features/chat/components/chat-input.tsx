/* eslint-disable @next/next/no-img-element */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { UserFile } from "@/lib/client";
import { useAttachmentDraft } from "../hooks/use-attachment-draft";
import { LibraryFilePicker } from "@/components/file-manager/library-file-picker";
import { KnowledgeStatus } from "@/components/file-manager/knowledge-status";
import { cn } from "@/lib/utils";
import {
  IconArrowUp,
  IconCirclePlus,
  IconPaperclip,
  IconPlayerStop,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

type UploadState = "queued" | "uploading" | "ready" | "failed";

const uploadErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error &&
    "detail" in error &&
    typeof error.detail === "string"
  )
    return error.detail;
  return "Upload failed. Please retry.";
};

interface AttachedFile {
  id: string;
  name: string;
  file?: File;
  source?: UserFile;
  preview?: string;
  state: UploadState;
  error?: string;
  sourceId?: string;
}

export type ChatInput2Props = {
  bottomComponent?: React.JSX.Element;
  onSubmit: (data: {
    prompt: string;
    files: string[];
    requestId: string;
    draftId?: string;
  }) => void | Promise<unknown>;
  requestScope?: string;
  chatId?: string;
  projectId?: string | null;
  savedFileIds?: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onLineNumberChange?: (lines: number) => void;
  isProcessing?: boolean;
  onStop?: () => void;
};

export const ChatInputContainer = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring bg-background mx-auto flex min-h-0 w-full max-w-full min-w-0 flex-col rounded-[10px] border focus-within:ring-2",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const ChatInput = ({
  bottomComponent,
  onSubmit,
  requestScope,
  chatId,
  projectId,
  savedFileIds = [],
  disabled,
  onStop,
  onLineNumberChange,
  isProcessing,
  placeholder,
  className,
}: ChatInput2Props) => {
  const draft = useAttachmentDraft(chatId);
  const [isStaging, setIsStaging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const submittingRef = useRef(false);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
  const numberOfLinesRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback((files: File[]) => {
    requestRef.current = null;
    const additions = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      file,
      state: "queued" as const,
      preview: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined,
    }));
    additions.forEach((file) => {
      if (file.preview) previewUrls.current.add(file.preview);
    });
    setAttachedFiles((previous) => [...previous, ...additions]);
  }, []);

  const updateFile = useCallback(
    (id: string, update: Partial<AttachedFile>) =>
      setAttachedFiles((files) =>
        files.map((file) => (file.id === id ? { ...file, ...update } : file)),
      ),
    [],
  );

  const removeFile = useCallback(
    async (id: string) => {
      requestRef.current = null;
      const selected = attachedFiles.find((item) => item.id === id);
      setIsStaging(true);
      try {
        if (selected?.sourceId) await draft.remove(selected.sourceId);
        setAttachedFiles((files) => {
          const file = files.find((item) => item.id === id);
          if (file?.preview) {
            URL.revokeObjectURL(file.preview);
            previewUrls.current.delete(file.preview);
          }
          return files.filter((item) => item.id !== id);
        });
      } catch (error) {
        setSendError(uploadErrorMessage(error));
      } finally {
        setIsStaging(false);
      }
    },
    [attachedFiles, draft],
  );

  function clearAttachments() {
    attachedFiles.forEach((file) => {
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
        previewUrls.current.delete(file.preview);
      }
    });
    setAttachedFiles([]);
    requestRef.current = null;
  }
  async function discardAttachments() {
    setIsStaging(true);
    setSendError(undefined);
    try {
      await draft.discard();
    } catch {
      setSendError(
        "Attachments cleared here. If server cleanup failed, staged references expire automatically; library files remain.",
      );
    } finally {
      clearAttachments();
      setIsStaging(false);
    }
  }

  const stageUploads = async () =>
    Promise.all(
      attachedFiles.map(async (attachment) => {
        if (attachment.sourceId) return attachment.sourceId;
        if (!attachment.file) return null;
        updateFile(attachment.id, { state: "uploading", error: undefined });
        try {
          const data = await draft.upload(attachment.file);
          const uploaded = data.files[0];
          if (!uploaded)
            throw new Error("The server did not return an uploaded file.");
          updateFile(attachment.id, {
            state: "ready",
            sourceId: uploaded.id,
            source: uploaded,
          });
          return uploaded.id;
        } catch (error) {
          updateFile(attachment.id, {
            state: "failed",
            error: uploadErrorMessage(error),
          });
          return null;
        }
      }),
    );
  const pickFiles = async (files: UserFile[]) => {
    requestRef.current = null;
    setIsStaging(true);
    try {
      await draft.add(files.map((file) => file.id));
      setAttachedFiles((current) => [
        ...current,
        ...files
          .filter((file) => !current.some((item) => item.sourceId === file.id))
          .map((source) => ({
            id: source.id,
            sourceId: source.id,
            name: source.original_name,
            source,
            state: "ready" as const,
          })),
      ]);
    } finally {
      setIsStaging(false);
    }
  };

  const submitPrompt = async () => {
    if (
      disabled ||
      isStaging ||
      submittingRef.current ||
      !onSubmit ||
      (!prompt.trim() && !attachedFiles.length)
    )
      return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setSendError(undefined);
    const uploads = await stageUploads();
    const uploadedIds = uploads.filter((id): id is string => id !== null);
    const files = [...new Set(uploadedIds)];
    try {
      // Uploads are library sources; no partial message is accepted after an upload failure.
      if (uploadedIds.length !== attachedFiles.length) return;
      const signature = JSON.stringify({
        prompt: prompt.trim(),
        files,
        draftId: draft.id.current,
        scope: requestScope,
      });
      if (requestRef.current?.signature !== signature) {
        await draft.verify(files);
        requestRef.current = { signature, id: crypto.randomUUID() };
      }
      await onSubmit({
        prompt: prompt.trim(),
        files,
        requestId: requestRef.current.id,
        ...(draft.id.current ? { draftId: draft.id.current } : {}),
      });
      draft.consumed();
      clearAttachments();
      setPrompt("");
      requestRef.current = null;
    } catch (error) {
      setSendError(uploadErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const hasPrompt = prompt.trim().length > 0;
  const isDisabled = disabled || isSubmitting || isStaging || !hasPrompt;

  return (
    <form
      className={cn(
        "bg-muted/70 text-foreground relative flex min-w-0 shrink-0 rounded-[inherit]",
        className,
      )}
      onDragLeave={() => setIsDragOver(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragOver(false);
        if (!disabled && !isSubmitting && !isStaging)
          addFiles(Array.from(event.dataTransfer.files));
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submitPrompt();
      }}
    >
      <div
        className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]"
        onClick={() => textareaRef.current?.focus()}
      >
        <div
          className="relative flex min-w-0 flex-wrap items-center gap-2 p-1"
          aria-live="polite"
        >
          <input
            aria-label="Choose attachments"
            className="sr-only"
            multiple
            onChange={(event) => {
              if (!disabled && !submittingRef.current)
                addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <Button
            aria-label="Add attachments"
            disabled={disabled || isSubmitting || isStaging}
            onClick={() => fileInputRef.current?.click()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <IconPlus />
          </Button>
          <LibraryFilePicker
            disabled={disabled || isSubmitting || isStaging}
            excludedIds={[
              ...savedFileIds,
              ...attachedFiles.flatMap((file) =>
                file.sourceId ? [file.sourceId] : [],
              ),
            ]}
            projectId={projectId}
            onPick={pickFiles}
          />
          {!!attachedFiles.length && (
            <span className="text-muted-foreground text-xs">
              Next message · this chat only
            </span>
          )}
          {attachedFiles.map((file) => (
            <Badge
              className="group bg-background relative h-7 max-w-full min-w-0 rounded-lg! px-1 text-[13px]"
              key={file.id}
              variant={file.state === "failed" ? "destructive" : "outline"}
            >
              {file.preview ? (
                <img
                  alt=""
                  className="h-5 w-5 rounded object-cover"
                  src={file.preview}
                />
              ) : (
                <IconPaperclip size={14} />
              )}
              <span className="truncate px-1">{file.name}</span>
              {file.state === "uploading" && (
                <span className="text-xs">Uploading…</span>
              )}
              {file.state === "queued" && (
                <span className="text-xs">Queued</span>
              )}
              {file.state === "ready" && <span className="text-xs">Ready</span>}
              {file.state === "failed" && (
                <span className="text-xs">Failed</span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${file.name}`}
                className="ml-auto rounded-full p-0.5 focus-visible:outline"
                disabled={disabled || isSubmitting || isStaging}
                onClick={() => removeFile(file.id)}
                type="button"
              >
                <IconX size={13} />
              </Button>
            </Badge>
          ))}
        </div>
        {!!attachedFiles.length && (
          <div className="flex min-w-0 flex-col gap-2 px-2 text-xs">
            <p>
              Draft attachments are staged until you send. Removing or
              discarding keeps the library files. Saved context estimates
              exclude these unsent attachments.
            </p>
            {attachedFiles
              .filter((file) => file.source)
              .map((file) => (
                <div key={file.id} aria-label={`Processing ${file.name}`}>
                  <span>{file.name}</span>
                  <KnowledgeStatus
                    filename={file.source!.filename}
                    projects={[]}
                  />
                </div>
              ))}
            <div className="flex flex-wrap gap-2">
              {attachedFiles.some(
                (file) => file.state === "queued" || file.state === "failed",
              ) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || isSubmitting || isStaging}
                  onClick={async () => {
                    setIsStaging(true);
                    try {
                      await stageUploads();
                    } finally {
                      setIsStaging(false);
                    }
                  }}
                >
                  Upload / retry attachments
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || isSubmitting || isStaging}
                onClick={discardAttachments}
              >
                Discard attachments
              </Button>
            </div>
          </div>
        )}
        {attachedFiles
          .filter((file) => file.state === "failed")
          .map((file) => (
            <p
              className="text-destructive px-2 pb-1 text-xs [overflow-wrap:anywhere]"
              key={`${file.id}-error`}
              role="alert"
            >
              {file.name}: {file.error}
            </p>
          ))}
        {sendError && (
          <p role="alert" className="text-destructive px-2 text-xs">
            {sendError}
          </p>
        )}
        <Textarea
          disabled={disabled || isSubmitting || isStaging}
          aria-label="Message"
          ref={textareaRef}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            const lines = Math.min(8, event.target.value.split(/\n/).length);
            if (lines !== numberOfLinesRef.current) {
              numberOfLinesRef.current = lines;
              onLineNumberChange?.(lines);
            }
          }}
          className={cn(
            "box-border rounded-none! border-0 bg-transparent! p-2! ring-0 outline-0",
            "focus-visible:ring-0 focus-visible:outline-0",
            "max-h-40! min-h-7!",
          )}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (!isDisabled) void submitPrompt();
            }
          }}
          placeholder={placeholder}
        />
        {bottomComponent}
      </div>
      {isProcessing && onStop ? (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="m-1 shrink-0 self-end"
          aria-label="Stop generating"
          onClick={onStop}
        >
          <IconPlayerStop />
        </Button>
      ) : (
        <Button
          type="submit"
          variant="secondary"
          size="icon"
          className={cn("m-1 shrink-0 self-end", !hasPrompt && "hidden")}
          disabled={isDisabled}
          aria-label="Send message"
          onClick={(event) => {
            event.preventDefault();
            void submitPrompt();
          }}
        >
          <IconArrowUp />
        </Button>
      )}
      <div
        className={cn(
          "border-border bg-muted text-foreground pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border border-dashed text-sm",
          isDragOver ? "opacity-100" : "opacity-0",
        )}
      >
        <IconCirclePlus className="mr-1" size={16} />
        Drop files here to add as attachments
      </div>
    </form>
  );
};
