import { APIDownload } from "@/components/api-download";
import { APIImage } from "@/components/api-image";
import { Badge } from "@/components/ui/badge";
import { MessageFileReference } from "@/lib/client";
import { FileWarningIcon, PaperclipIcon } from "lucide-react";

const formatSize = (size: number) =>
  size < 1024 ? `${size} B` : `${(size / 1024).toFixed(size < 1024 * 1024 ? 1 : 0)} ${size < 1024 * 1024 ? "KB" : "MB"}`;

export function MessageAttachments({ files }: { files: MessageFileReference[] }) {
  if (!files.length) return null;
  return <div className="mt-2 flex max-w-full flex-wrap justify-end gap-2" aria-label="Message attachments">
    {files.map((file) => {
      if (file.status === "failed" || file.status === "unsupported") {
        return <Badge className="h-auto max-w-64 whitespace-normal text-left" key={file.filename} variant="destructive"><FileWarningIcon size={14} />{file.name} — {file.status === "failed" ? "unavailable" : "unsupported"}</Badge>;
      }
      if (file.kind === "image") {
        return <div className="overflow-hidden rounded-md border" key={file.filename}><APIImage alt={file.name} className="h-20 w-20 object-cover" filename={file.filename} height={80} width={80} /></div>;
      }
      return <Badge className="h-auto max-w-64 gap-1 whitespace-normal text-left" key={file.filename} variant="outline"><PaperclipIcon size={14} /><span className="truncate">{file.name}</span><span className="text-muted-foreground">{formatSize(file.size)}</span><APIDownload className="underline" filename={file.filename} /></Badge>;
    })}
  </div>;
}
