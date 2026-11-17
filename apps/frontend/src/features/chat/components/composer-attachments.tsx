/* eslint-disable @next/next/no-img-element */
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type {
  AttachedFile,
  UploadState,
} from "@/features/chat/hooks/use-composer-attachments";
import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

/** The composer's attachment chips, with retry and discard, then any upload errors. */
export function ComposerAttachments({
  files,
  disabled,
  onRemove,
  onRetry,
  onDiscard,
}: {
  files: AttachedFile[];
  disabled: boolean;
  onRemove: (id: string) => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (!files.length) return null;
  const retryable = files.some(
    (file) => file.state === "queued" || file.state === "failed",
  );
  return (
    <>
      <div
        className="flex min-w-0 flex-wrap items-center gap-2 px-3 pt-3"
        aria-live="polite"
      >
        {files.map((file) => (
          <AttachmentChip
            key={file.id}
            file={file}
            disabled={disabled}
            onRemove={() => onRemove(file.id)}
          />
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          {retryable && (
            <Hint hint="Upload now">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Upload / retry attachments"
                disabled={disabled}
                onClick={onRetry}
              >
                <RefreshCwIcon />
              </Button>
            </Hint>
          )}
          <Hint hint="Discard attachments">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Discard attachments"
              disabled={disabled}
              onClick={onDiscard}
            >
              <Trash2Icon />
            </Button>
          </Hint>
        </div>
      </div>
      {files
        .filter((file) => file.state === "failed")
        .map((file) => (
          <p
            className="text-destructive flex items-start gap-1.5 px-3 pt-2 text-xs"
            key={`${file.id}-error`}
            role="alert"
          >
            <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
            <span>
              {file.name}: {file.error}
            </span>
          </p>
        ))}
    </>
  );
}

const statusLabel: Record<UploadState, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  ready: "Ready",
  failed: "Failed",
};

const AttachmentChip = ({
  file,
  disabled,
  onRemove,
}: {
  file: AttachedFile;
  disabled: boolean;
  onRemove: () => void;
}) => (
  <div
    className={cn(
      "rounded-surface flex max-w-full min-w-0 items-center gap-2 border p-1 pr-1.5 text-xs",
      file.state === "failed" ? "border-destructive" : "border-border",
    )}
  >
    <span className="bg-background text-foreground rounded-control flex size-8 shrink-0 items-center justify-center overflow-hidden border">
      {file.preview ? (
        <img alt="" className="size-full object-cover" src={file.preview} />
      ) : (
        <FileTextIcon className="size-4" />
      )}
    </span>
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="max-w-40 truncate font-medium sm:max-w-56">
        {file.name}
      </span>
      <span
        className={cn(
          "flex items-center gap-1",
          file.state === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {file.state === "uploading" && (
          <LoaderCircleIcon className="size-3 animate-spin" />
        )}
        {statusLabel[file.state]}
      </span>
    </span>
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Remove ${file.name}`}
      className="rounded-control"
      disabled={disabled}
      onClick={onRemove}
      type="button"
    >
      <XIcon />
    </Button>
  </div>
);
