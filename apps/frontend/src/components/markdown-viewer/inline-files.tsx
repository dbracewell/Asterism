"use client";
/* eslint-disable @next/next/no-img-element -- bytes come from a local blob URL */

import { APIDownload } from "@/components/api-download";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { client } from "@/lib/api";
import type { InlineFileReference } from "@/lib/client";
import { chatFileDownloadOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { FileIcon, FileWarningIcon, ImageIcon } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

/**
 * Server-resolved file references for the Markdown being rendered (ADR-0039).
 * `files: null` means the message is still streaming and has no resolved list.
 * Without a provider every token is inert.
 */
type InlineFiles = {
  chatId: string | null;
  files: InlineFileReference[] | null;
};

const InlineFilesContext = createContext<InlineFiles>({
  chatId: null,
  files: [],
});

export const InlineFilesProvider = InlineFilesContext.Provider;

/** Narrows the resolved list (e.g. to one sub-agent's output) within the same chat. */
export function InlineFilesScope({
  files,
  children,
}: {
  files: InlineFileReference[] | null;
  children: React.ReactNode;
}) {
  const { chatId } = useContext(InlineFilesContext);
  return (
    <InlineFilesProvider value={{ chatId, files }}>
      {children}
    </InlineFilesProvider>
  );
}

/** Raster types plus SVG; SVG only ever reaches an `<img>` via a blob URL. */
export const INLINE_IMAGE_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

/** Larger images are offered for download instead of being fetched inline. */
export const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;

const inert =
  "text-muted-foreground bg-muted rounded-control inline-flex max-w-full items-center gap-1 px-1.5 py-0.5 align-baseline text-[0.9em]";

const sizeLabel = (size?: number | null) =>
  size == null
    ? ""
    : size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const isInlineImage = (file: InlineFileReference) =>
  !!file.mime_type && INLINE_IMAGE_TYPES.has(file.mime_type);

export function InlineFile({
  fileId,
  label,
  embed,
}: {
  fileId: string;
  label: string;
  embed: boolean;
}) {
  const { chatId, files } = useContext(InlineFilesContext);
  if (files === null)
    return (
      <span className={inert} data-inline-file="pending">
        <FileIcon aria-hidden="true" size={14} />
        {label ? `File pending: ${label}` : "File pending"}
      </span>
    );
  // The ID in the text grants nothing; only the resolved list does.
  const file = files.find((entry) => entry.file_id === fileId);
  if (!chatId || !file?.available)
    return (
      <span className={inert} data-inline-file="unavailable">
        <FileWarningIcon aria-hidden="true" size={14} />
        {label ? `File unavailable: ${label}` : "File unavailable"}
      </span>
    );
  const name = label || file.name || "File";
  if (
    embed &&
    isInlineImage(file) &&
    (file.size ?? 0) <= MAX_INLINE_IMAGE_BYTES
  )
    return <InlineImage chatId={chatId} file={file} alt={name} />;
  return <FileChip chatId={chatId} file={file} name={name} />;
}

/** Fetches bytes only through the scoped chat-file route, as a typed blob. */
function useImageUrl(
  chatId: string,
  file: InlineFileReference,
  enabled = true,
) {
  const { data, isError } = useQuery({
    ...chatFileDownloadOptions({
      client,
      path: { chat_id: chatId, file_id: file.file_id },
    }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  // Object URL lifecycle only; the bytes themselves are loaded by the query.
  useEffect(() => {
    if (!data || !file.mime_type) return;
    const objectUrl = URL.createObjectURL(
      new Blob([data], { type: file.mime_type }),
    );
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [data, file.mime_type]);
  return { url, isError };
}

function InlineImage({
  chatId,
  file,
  alt,
}: {
  chatId: string;
  file: InlineFileReference;
  alt: string;
}) {
  const { url, isError } = useImageUrl(chatId, file);
  if (isError)
    return (
      <span className={inert} data-inline-file="unavailable">
        <FileWarningIcon aria-hidden="true" size={14} />
        {`File unavailable: ${alt}`}
      </span>
    );
  if (!url)
    return (
      // A span: inline images sit inside Markdown paragraphs.
      <span
        role="status"
        aria-label={`Loading ${alt}`}
        className="bg-muted rounded-surface my-2 block h-40 w-60 max-w-full animate-pulse"
      />
    );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`Open image ${alt}`}
          className="rounded-surface my-2 block h-auto max-w-full overflow-hidden border p-0"
          data-inline-file="image"
        >
          <img
            src={url}
            alt={alt}
            className="block max-h-80 w-auto max-w-full cursor-zoom-in object-contain"
          />
        </Button>
      </DialogTrigger>
      <Lightbox chatId={chatId} file={file} name={alt}>
        <img
          src={url}
          alt={alt}
          className="max-h-[calc(100dvh-8rem)] max-w-full object-contain"
        />
      </Lightbox>
    </Dialog>
  );
}

function FileChip({
  chatId,
  file,
  name,
}: {
  chatId: string;
  file: InlineFileReference;
  name: string;
}) {
  const image = isInlineImage(file);
  const Icon = image ? ImageIcon : FileIcon;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="mx-0.5 h-auto max-w-full gap-1 px-1.5 py-0.5 align-baseline text-[0.9em]"
          aria-label={`Open file ${name}`}
          data-inline-file="chip"
        >
          <Icon aria-hidden="true" size={14} />
          <span className="truncate">{name}</span>
        </Button>
      </DialogTrigger>
      <Lightbox chatId={chatId} file={file} name={name}>
        {image && (file.size ?? 0) <= MAX_INLINE_IMAGE_BYTES ? (
          <LightboxImage chatId={chatId} file={file} alt={name} />
        ) : (
          <p className="text-muted-foreground text-sm">
            No preview is available for this file.
          </p>
        )}
      </Lightbox>
    </Dialog>
  );
}

function LightboxImage({
  chatId,
  file,
  alt,
}: {
  chatId: string;
  file: InlineFileReference;
  alt: string;
}) {
  const { url, isError } = useImageUrl(chatId, file);
  if (isError)
    return <p className="text-destructive text-sm">File unavailable.</p>;
  if (!url)
    return (
      <Skeleton
        role="status"
        aria-label="Loading image"
        className="h-60 w-80"
      />
    );
  return (
    <img
      src={url}
      alt={alt}
      className="max-h-[calc(100dvh-8rem)] max-w-full object-contain"
    />
  );
}

function Lightbox({
  chatId,
  file,
  name,
  children,
}: {
  chatId: string;
  file: InlineFileReference;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[95vw]! flex-col items-center gap-3">
      <DialogTitle className={cn("max-w-full truncate pr-8")}>
        {name}
      </DialogTitle>
      <DialogDescription>
        {[file.mime_type, sizeLabel(file.size)].filter(Boolean).join(" · ")}
      </DialogDescription>
      {children}
      <APIDownload
        chatId={chatId}
        fileId={file.file_id}
        filename={file.name || name}
        linkText="Download"
      />
    </DialogContent>
  );
}
