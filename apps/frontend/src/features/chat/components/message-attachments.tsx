import { APIDownload } from "@/components/api-download";
import { APIImage } from "@/components/api-image";
import { Badge } from "@/components/ui/badge";
import { MessageFileReference } from "@/lib/client";
import { FileWarningIcon, PaperclipIcon } from "lucide-react";

const formatSize = (size: number) =>
  size < 1024
    ? `${size} B`
    : `${(size / 1024).toFixed(size < 1024 * 1024 ? 1 : 0)} ${size < 1024 * 1024 ? "KB" : "MB"}`;

export function MessageAttachments({
  files,
  chatId,
}: {
  files: MessageFileReference[];
  chatId: string;
}) {
  if (!files.length) return null;
  return (
    <div
      className="mt-2 flex max-w-full flex-wrap justify-end gap-2"
      aria-label="Message attachments"
    >
      {files.map((file) => {
        if (
          file.available === false ||
          file.status === "failed" ||
          file.status === "unsupported"
        ) {
          return (
            <Badge
              className="h-auto max-w-full min-w-0 text-left [overflow-wrap:anywhere] whitespace-normal"
              key={file.file_id}
              variant="destructive"
            >
              <FileWarningIcon size={14} />
              {file.name} —{" "}
              {file.available === false || file.status === "failed"
                ? "unavailable"
                : "unsupported"}
            </Badge>
          );
        }
        if (file.kind === "image") {
          return (
            <div
              className="overflow-hidden rounded-md border"
              key={file.file_id}
            >
              <APIImage
                alt={file.name}
                className="h-20 w-20 object-cover"
                filename={file.filename}
                fileId={file.file_id}
                chatId={chatId}
                height={80}
                width={80}
              />
            </div>
          );
        }
        return (
          <Badge
            className="h-auto max-w-full min-w-0 gap-1 text-left [overflow-wrap:anywhere] whitespace-normal"
            key={file.file_id}
            variant="outline"
          >
            <PaperclipIcon size={14} />
            <span className="truncate">{file.name}</span>
            <span className="text-muted-foreground">
              {formatSize(file.size)}
            </span>
            <APIDownload
              className="min-w-0 break-all underline"
              filename={file.filename}
              fileId={file.file_id}
              chatId={chatId}
            />
          </Badge>
        );
      })}
    </div>
  );
}
