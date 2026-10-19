/* eslint-disable @next/next/no-img-element */

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
  chatFileGetInfoOptions,
  fileGetFileInfoOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { UserFile, ErrorDetail } from "@/lib/client";

import { Loader2 } from "lucide-react";

type ImageProps = {
  filename: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  zoomable?: boolean;
  className?: string;
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
  const result = useQuery(
    fileGetFileInfoOptions({ client, path: { filename: props.filename } }),
  );
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
  return <ImageContent {...props} result={result} />;
};

const ImageContent = ({
  alt = "Generated image",
  width = "auto",
  height = "auto",
  zoomable = false,
  className,
  result: { data, isLoading, error },
}: ImageProps & { result: UseQueryResult<UserFile, ErrorDetail> }) => {
  if (error) {
    return (
      <div
        role="alert"
        className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4"
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
        className="flex items-center justify-center rounded-lg"
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
        className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4"
      >
        No thumbnail available for this image
      </div>
    );
  }

  if (zoomable) {
    return (
      <Dialog>
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
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[95vw]! items-center justify-center border-0! p-0">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">
            Enlarged image preview.
          </DialogDescription>
          <img
            src={data.thumbnail}
            alt={alt}
            className="max-h-[calc(100dvh-2rem)] max-w-full rounded-md object-contain"
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
