import { saveBlob } from "@/lib/save-blob";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useState } from "react";

export const APIDownload = ({
  filename,
  fileId,
  chatId,
  className,
  linkText,
}: {
  filename: string;
  className?: string;
  linkText?: string;
} & (
  { chatId?: never; fileId?: never } | { chatId: string; fileId: string }
)) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (loading || error) return;

    setLoading(true);
    try {
      const { data } =
        chatId && fileId
          ? await api.chatFileDownload({
              path: { chat_id: chatId, file_id: fileId },
            })
          : await api.fileGetOne({ path: { filename } });
      if (!data) throw new Error("File is unavailable");
      saveBlob(data instanceof Blob ? data : new Blob([data]), filename);
    } catch (fetchError) {
      console.error("Failed to fetch file", fetchError);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <span role="alert" className="text-destructive">
        Failed to retrieve <span className="font-bold">{filename}</span>
      </span>
    );
  }

  return (
    <Button
      variant="link"
      asChild
      className={cn("h-auto p-0 font-normal", className)}
    >
      <a
        href="#"
        onClick={handleClick}
        aria-busy={loading}
        aria-label={`Download ${filename}`}
      >
        {loading ? "Loading…" : (linkText ?? filename)}
      </a>
    </Button>
  );
};
