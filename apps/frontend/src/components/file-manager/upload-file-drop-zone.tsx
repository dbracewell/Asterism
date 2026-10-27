"use client";
import { useFileManager } from "@/components/file-manager/context";
import { useUploadFiles } from "@/components/file-manager/hooks";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CirclePlusIcon } from "lucide-react";
import { useState } from "react";

export const UploadFileDropZone = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const { isMutating, source, actions } = useFileManager();
  const uploadFiles = useUploadFiles();
  return (
    <section
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setIsDragOver(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (actions.upload && !isMutating) setIsDragOver(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length === 0) return;
        setIsDragOver(false);
        uploadFiles(event.dataTransfer.files);
      }}
      className={cn("flex min-h-0 w-full min-w-0 flex-1 flex-col", className)}
    >
      <div
        className={cn(
          "border-border bg-muted/40 text-foreground pointer-events-none absolute inset-0 z-20 flex items-center justify-center border border-dashed text-sm",
          isMutating ? "opacity-100" : "opacity-0",
        )}
      >
        <Spinner />
      </div>
      <div
        className={cn(
          "border-border bg-muted/40 text-foreground pointer-events-none absolute inset-0 z-20 flex items-center justify-center border border-dashed text-sm",
          isDragOver ? "opacity-100" : "opacity-0",
        )}
      >
        <CirclePlusIcon className="mr-1" size={16} />
        {source.kind === "project"
          ? "Drop files here to upload and add to this project"
          : "Drop files here to upload to your library"}
      </div>
      {children}
    </section>
  );
};
