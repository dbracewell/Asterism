/* eslint-disable @next/next/no-img-element */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  IconArrowUp,
  IconCirclePlus,
  IconPaperclip,
  IconPlayerStop,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";

type UploadState = "queued" | "uploading" | "failed";

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
  file: File;
  preview?: string;
  state: UploadState;
  error?: string;
}

export type ChatInput2Props = {
  bottomComponent?: React.JSX.Element;
  onSubmit: (data: { prompt: string; files: string[] }) => void;
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
        "bg-background mx-auto flex w-full max-w-[80%] flex-col overflow-clip rounded-xl border",
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
  disabled,
  onStop,
  onLineNumberChange,
  isProcessing,
  placeholder,
  className,
}: ChatInput2Props) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const numberOfLinesRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback((files: File[]) => {
    const additions = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      file,
      state: "queued" as const,
      preview: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined,
    }));
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
    (id: string) =>
      setAttachedFiles((files) => {
        const file = files.find((item) => item.id === id);
        if (file?.preview) URL.revokeObjectURL(file.preview);
        return files.filter((item) => item.id !== id);
      }),
    [],
  );

  const submitPrompt = async () => {
    if (
      disabled ||
      isSubmitting ||
      !onSubmit ||
      (!prompt.trim() && !attachedFiles.length)
    )
      return;
    setIsSubmitting(true);
    const uploads = await Promise.all(
      attachedFiles.map(async (attachment) => {
        updateFile(attachment.id, { state: "uploading", error: undefined });
        try {
          // This generated client is deliberately used instead of a hand-written fetch.
          const { data } = await api.fileUpload({
            body: { files: [attachment.file] },
          });
          const uploaded = data?.files[0];
          if (!uploaded)
            throw new Error("The server did not return an uploaded file.");
          return uploaded.filename;
        } catch (error) {
          // This is an expected, user-correctable state. Do not use console.error:
          // Next.js development mode presents those as an application error overlay.
          console.warn("File upload failed", {
            name: attachment.name,
            error,
          });
          updateFile(attachment.id, {
            state: "failed",
            error: uploadErrorMessage(error),
          });
          return null;
        }
      }),
    );
    const files = uploads.filter(
      (filename): filename is string => filename !== null,
    );
    setIsSubmitting(false);

    // Do not send a partial set: failed chips remain retryable with the prompt intact.
    if (files.length !== attachedFiles.length) return;

    onSubmit({ prompt: prompt.trim(), files });

    attachedFiles.forEach(
      (file) => file.preview && URL.revokeObjectURL(file.preview),
    );

    setAttachedFiles([]);
    setPrompt("");
  };

  const hasPrompt = prompt.trim().length > 0;
  const isDisabled = disabled || isSubmitting || !hasPrompt;

  return (
    <form
      className={cn(
        "bg-input/70 text-foreground flex overflow-clip rounded-[inherit]",
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
        addFiles(Array.from(event.dataTransfer.files));
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submitPrompt();
      }}
    >
      <div
        className="flex flex-1 flex-col"
        onClick={() => textareaRef.current?.focus()}
      >
        <div
          className="relative flex flex-wrap items-center gap-2 overflow-hidden p-1"
          aria-live="polite"
        >
          <input
            aria-label="Choose attachments"
            className="sr-only"
            multiple
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <Button
            aria-label="Add attachments"
            onClick={() => fileInputRef.current?.click()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <IconPlus />
          </Button>
          {attachedFiles.map((file) => (
            <Badge
              className="group bg-background relative h-7 max-w-56 rounded-lg! px-1 text-[13px]"
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
              {file.state === "failed" && (
                <span className="text-xs">Failed</span>
              )}
              <button
                aria-label={`Remove ${file.name}`}
                className="ml-auto rounded-full p-0.5 focus-visible:outline"
                onClick={() => removeFile(file.id)}
                type="button"
              >
                <IconX size={13} />
              </button>
            </Badge>
          ))}
        </div>
        {attachedFiles
          .filter((file) => file.state === "failed")
          .map((file) => (
            <p
              className="text-destructive px-2 pb-1 text-xs"
              key={`${file.id}-error`}
              role="alert"
            >
              {file.name}: {file.error}
            </p>
          ))}
        <Textarea
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
        <button
          type="button"
          className={cn(
            "bg-destructive/10 flex items-center border-l px-1 [&_svg]:size-4",
            "hover:bg-destructive/90 hover:text-white",
          )}
          aria-label="Stop generating"
          onClick={onStop}
        >
          <IconPlayerStop size={16} />
        </button>
      ) : (
        <button
          type="submit"
          className={cn(
            "bg-secondary text-secondary-foreground flex items-center border-l px-1 [&_svg]:size-4",
            "hover:bg-primary/80 hover:text-primary-foreground",
            "disabled:hover:bg-secondary disabled:hover:text-secondary-foreground disabled:opacity-50",
            !hasPrompt && "hidden",
          )}
          disabled={isDisabled}
          aria-label="Send message"
          onClick={submitPrompt}
        >
          <IconArrowUp size={16} />
        </button>
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
