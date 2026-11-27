/* eslint-disable @next/next/no-img-element */

import { displayableImage } from "@/lib/displayable-image";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { client } from "@/lib/api";
import {
  chatFileDownloadOptions,
  chatFileGetInfoOptions,
  fileGetFileInfoOptions,
  fileGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { UserFile, ErrorDetail } from "@/lib/client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

type ImageProps = {
  filename: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  zoomable?: boolean;
  className?: string;
  thumbnail?: string | null;
};

export const APIImage = ({
  chatId,
  fileId,
  ...props
}: ImageProps &
  ({ chatId?: never; fileId?: never } | { chatId: string; fileId: string })) =>
  chatId && fileId ? (
    <ChatImage {...props} chatId={chatId} fileId={fileId} />
  ) : (
    <LibraryImage {...props} />
  );

const LibraryImage = (props: ImageProps) => {
  const result = useQuery({
    ...fileGetFileInfoOptions({ client, path: { filename: props.filename } }),
    enabled: props.thumbnail === undefined,
  });
  if (props.thumbnail !== undefined) {
    const directResult = {
      data: props.thumbnail
        ? ({
            filename: props.filename,
            original_name: props.alt ?? "Generated image",
            thumbnail: props.thumbnail,
          } as UserFile)
        : null,
      isLoading: false,
      error: null,
    } as unknown as UseQueryResult<UserFile, ErrorDetail>;
    return <ImageContent {...props} result={directResult} />;
  }
  return <ImageContent {...props} result={result} />;
};

const ChatImage = ({
  chatId,
  fileId,
  ...props
}: ImageProps & { chatId: string; fileId: string }) => {
  const result = useQuery(
    chatFileGetInfoOptions({
      client,
      path: { chat_id: chatId, file_id: fileId },
    }),
  );
  return (
    <ImageContent {...props} chatId={chatId} fileId={fileId} result={result} />
  );
};

/**
 * Loads the original image bytes once the preview opens and exposes them as an
 * object URL. The query owns the bytes; the effect only owns the URL, which is
 * revoked when the bytes change (another file) or on unmount.
 */
function useFullImageUrl({
  chatId,
  fileId,
  filename,
  enabled,
}: {
  chatId?: string;
  fileId?: string;
  filename: string;
  enabled: boolean;
}) {
  const isChatFile = Boolean(chatId && fileId);
  const chatQuery = useQuery({
    ...chatFileDownloadOptions({
      client,
      path: { chat_id: chatId ?? "", file_id: fileId ?? "" },
    }),
    enabled: enabled && isChatFile,
    staleTime: Infinity,
    retry: false,
  });
  const libraryQuery = useQuery({
    ...fileGetOneOptions({ client, path: { filename } }),
    enabled: enabled && !isChatFile,
    staleTime: Infinity,
    retry: false,
  });
  const { data, isFetching } = isChatFile ? chatQuery : libraryQuery;
  const [url, setUrl] = useState<string | null>(null);
  // SVGs are cleaned before they get an object URL (US-116.2).
  useEffect(() => {
    if (!data) return;
    let active = true;
    let objectUrl: string | null = null;
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
    void displayableImage(blob, blob.type).then((image) => {
      if (!active || !image) return;
      objectUrl = URL.createObjectURL(image);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [data]);
  return { url, isFetching };
}

type ImageContentProps = ImageProps & {
  chatId?: string;
  fileId?: string;
  result: UseQueryResult<UserFile, ErrorDetail>;
};

const ImageContent = ({
  alt = "Generated image",
  width = "auto",
  height = "auto",
  zoomable = false,
  className,
  chatId,
  fileId,
  filename,
  result: { data, isLoading, error },
}: ImageContentProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { url: fullImageUrl, isFetching: isLoadingFull } = useFullImageUrl({
    chatId,
    fileId,
    filename,
    enabled: isOpen,
  });

  if (error) {
    return (
      <div
        role="alert"
        className="border-destructive bg-destructive/10 text-destructive rounded-surface border p-4"
      >
        Failed to load image
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <Skeleton
        role="status"
        aria-label="Loading image"
        className="rounded-surface flex items-center justify-center"
        style={{
          width: width === "auto" ? 32 : width,
          height: height === "auto" ? 32 : height,
        }}
      >
        <Loader2
          aria-hidden="true"
          className="text-muted-foreground animate-spin"
        />
      </Skeleton>
    );
  }

  if (!data.thumbnail) {
    return (
      <div
        role="alert"
        className="border-destructive bg-destructive/10 text-destructive rounded-surface border p-4"
      >
        No thumbnail available for this image
      </div>
    );
  }

  if (zoomable) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            aria-label={`Enlarge ${alt}`}
            className="h-auto min-h-[24px] min-w-[24px] overflow-hidden p-0"
          >
            <img
              src={data.thumbnail}
              alt={alt}
              style={{
                width,
                height,
              }}
              className="cursor-zoom-in object-cover transition-opacity hover:opacity-90"
            />
          </Button>
        </DialogTrigger>
        <DialogContent className="relative flex max-h-[calc(100dvh-2rem)] max-w-[95vw]! items-center justify-center border-0! p-0">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">
            Enlarged image preview.
          </DialogDescription>
          {isLoadingFull && !fullImageUrl && (
            <div className="bg-background/50 absolute inset-0 flex items-center justify-center">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            </div>
          )}
          <img
            src={fullImageUrl ?? data.thumbnail}
            alt={alt}
            className="rounded-surface max-h-[calc(100dvh-2rem)] max-w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <img
      src={data.thumbnail}
      alt={alt}
      style={{
        width,
        height,
      }}
      className={cn("object-contain", className)}
    />
  );
};
