/* eslint-disable @next/next/no-img-element */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { client } from "@/lib/api";
import { chatFileGetInfoOptions, fileGetFileInfoOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { UserFile, ErrorDetail } from "@/lib/client";

import { DownloadIcon, Loader2 } from "lucide-react";

type ImageProps = {
  filename: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  zoomable?: boolean;
  className?: string;
};

export const APIImage = ({ chatId, fileId, ...props }: ImageProps & ({ chatId?: never; fileId?: never } | { chatId: string; fileId: string })) =>
  chatId && fileId ? <ChatImage {...props} chatId={chatId} fileId={fileId} /> : <LibraryImage {...props} />;

const LibraryImage = (props: ImageProps) => {
  const result = useQuery(fileGetFileInfoOptions({ client, path: { filename: props.filename } }));
  return <ImageContent {...props} result={result} />;
};

const ChatImage = ({ chatId, fileId, ...props }: ImageProps & { chatId: string; fileId: string }) => {
  const result = useQuery(chatFileGetInfoOptions({ client, path: { chat_id: chatId, file_id: fileId } }));
  return <ImageContent {...props} result={result} />;
};

const ImageContent = ({
  alt = "Generated image", width = "auto", height = "auto", zoomable = false, className,
  result: { data, isLoading, error },
}: ImageProps & { result: UseQueryResult<UserFile, ErrorDetail> }) => {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500">
        Failed to load image
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div
        className="flex animate-pulse items-center justify-center rounded-lg bg-gray-100"
        style={{
          width: width === "auto" ? "32" : "auto",
          height: height === "auto" ? "32" : "auto",
        }}
      >
        <Loader2 className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data.thumbnail) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500">
        No thumbnail available for this image
      </div>
    );
  }

  if (zoomable) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <button className="border-border focus-visible:ring-ring overflow-hidden rounded-md border text-white focus-visible:ring-2 focus-visible:outline-none">
            <img
              src={data.thumbnail}
              alt={alt}
              style={{
                width,
                height,
              }}
              className="cursor-zoom-in object-cover transition-opacity hover:opacity-90"
            />
          </button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[95vh]! max-w-[95vw]! items-center justify-center border-0! p-0">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            // onClick={handleDownload}
            title="Download Image"
            className="absolute top-2 right-20"
          >
            <DownloadIcon className="h-4 w-4" />
          </Button>

          <img
            src={data.thumbnail}
            alt={alt}
            className="max-h-[95vh] max-w-full rounded-md object-contain"
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
