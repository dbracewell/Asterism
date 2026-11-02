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
import type { InlineFileReference, SpanCitation } from "@/lib/client";
import type { FilePreview } from "@/lib/client";
import {
  chatFileDownloadOptions,
  chatFileGetPreviewOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileWarningIcon,
  ImageIcon,
  PresentationIcon,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

/**
 * Server-resolved file references (ADR-0039) and claim citations (ADR-0040) for
 * the Markdown being rendered. `null` means the message is still streaming and
 * has no resolved list. Without a provider every token is inert.
 */
type InlineFiles = {
  chatId: string | null;
  files: InlineFileReference[] | null;
  citations?: SpanCitation[] | null;
};

export const InlineFilesContext = createContext<InlineFiles>({
  chatId: null,
  files: [],
  citations: [],
});

export const InlineFilesProvider = InlineFilesContext.Provider;

/** Narrows the resolved lists (e.g. to one sub-agent's output) within the same chat. */
export function InlineFilesScope({
  files,
  citations = files === null ? null : [],
  children,
}: {
  files: InlineFileReference[] | null;
  citations?: SpanCitation[] | null;
  children: React.ReactNode;
}) {
  const { chatId } = useContext(InlineFilesContext);
  return (
    <InlineFilesProvider value={{ chatId, files, citations }}>
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

/** Documents and text get a card with a server-made plain-text excerpt (US-56.5). */
const hasTextPreview = (file: InlineFileReference) =>
  file.kind === "document" || file.kind === "text";

const TYPES: Record<string, { label: string; Icon: LucideIcon }> = {
  "application/pdf": { label: "PDF", Icon: FileTextIcon },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    label: "Word document",
    Icon: FileTextIcon,
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    label: "PowerPoint presentation",
    Icon: PresentationIcon,
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    label: "Excel workbook",
    Icon: FileSpreadsheetIcon,
  },
  "application/vnd.ms-excel": {
    label: "Excel workbook",
    Icon: FileSpreadsheetIcon,
  },
  "text/csv": { label: "CSV", Icon: FileSpreadsheetIcon },
  "text/markdown": { label: "Markdown", Icon: FileTextIcon },
  "text/plain": { label: "Text", Icon: FileTextIcon },
};

export const fileType = (file: InlineFileReference) =>
  (file.mime_type && TYPES[file.mime_type]) ||
  (isInlineImage(file)
    ? { label: "Image", Icon: ImageIcon }
    : { label: file.mime_type || "File", Icon: FileIcon });

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export const countLabel = (preview?: FilePreview) =>
  preview?.slide_count != null
    ? plural(preview.slide_count, "slide")
    : preview?.page_count != null
      ? plural(preview.page_count, "page")
      : preview?.sheet_count != null
        ? plural(preview.sheet_count, "sheet")
        : "";

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
  if (embed && hasTextPreview(file))
    return <DocumentCard chatId={chatId} file={file} name={name} />;
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
  const { Icon } = fileType(file);
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
        ) : hasTextPreview(file) ? (
          <PreviewText chatId={chatId} file={file} />
        ) : (
          <p className="text-muted-foreground text-sm">
            No preview is available for this file.
          </p>
        )}
      </Lightbox>
    </Dialog>
  );
}

function usePreview(chatId: string, file: InlineFileReference) {
  return useQuery({
    ...chatFileGetPreviewOptions({
      client,
      path: { chat_id: chatId, file_id: file.file_id },
    }),
    retry: false,
    staleTime: 60_000,
  });
}

/** A document card: type, name, size and counts, a short excerpt, Open and Download. */
function DocumentCard({
  chatId,
  file,
  name,
}: {
  chatId: string;
  file: InlineFileReference;
  name: string;
}) {
  const { label, Icon } = fileType(file);
  const preview = usePreview(chatId, file);
  const meta = [label, sizeLabel(file.size), countLabel(preview.data)]
    .filter(Boolean)
    .join(" · ");
  // Spans throughout: the card sits inside a Markdown paragraph.
  return (
    <span
      role="group"
      aria-label={`${label}: ${name}`}
      className="bg-card text-card-foreground rounded-surface my-2 flex max-w-xl flex-col gap-2 border p-3"
      data-inline-file="document"
    >
      <span className="flex min-w-0 items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 shrink-0" size={20} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{name}</span>
          <span className="text-muted-foreground text-xs">{meta}</span>
        </span>
      </span>
      {preview.isPending ? (
        <span
          role="status"
          aria-label={`Loading preview of ${name}`}
          className="bg-muted rounded-control block h-10 animate-pulse"
        />
      ) : preview.data?.excerpt ? (
        <span className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
          {preview.data.excerpt}
        </span>
      ) : null}
      <span className="flex items-center gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" aria-label={`Open ${name}`}>
              Open
            </Button>
          </DialogTrigger>
          <Lightbox chatId={chatId} file={file} name={name}>
            <PreviewText chatId={chatId} file={file} />
          </Lightbox>
        </Dialog>
        <APIDownload
          chatId={chatId}
          fileId={file.file_id}
          filename={file.name || name}
          linkText="Download"
        />
      </span>
    </span>
  );
}

/** The excerpt as literal text: file content is never parsed as Markdown or HTML. */
function PreviewText({
  chatId,
  file,
}: {
  chatId: string;
  file: InlineFileReference;
}) {
  const preview = usePreview(chatId, file);
  if (preview.isPending)
    return (
      <Skeleton
        role="status"
        aria-label="Loading preview"
        className="h-40 w-full"
      />
    );
  if (preview.isError)
    return <p className="text-destructive text-sm">File unavailable.</p>;
  const { excerpt, truncated, status } = preview.data;
  if (!excerpt)
    return (
      <p className="text-muted-foreground text-sm">
        {status === "pending"
          ? "The preview is still being prepared."
          : "No text preview is available for this file."}
      </p>
    );
  return (
    <div className="flex w-full max-w-3xl min-w-0 flex-col gap-2">
      {countLabel(preview.data) && (
        <p className="text-muted-foreground text-xs">
          {countLabel(preview.data)}
        </p>
      )}
      <pre
        role="region"
        tabIndex={0}
        aria-label="Text preview"
        className="bg-muted rounded-control max-h-[60dvh] overflow-auto p-3 text-sm whitespace-pre-wrap"
      >
        {excerpt}
      </pre>
      {truncated && (
        <p className="text-muted-foreground text-xs">
          Showing the start of the file. Download it to see everything.
        </p>
      )}
    </div>
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
