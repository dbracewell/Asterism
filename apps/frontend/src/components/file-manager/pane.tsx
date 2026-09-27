"use client";
import { useFileManager } from "@/components/file-manager/context";
import { Spinner } from "@/components/ui/spinner";
import { IconCirclePlus } from "@tabler/icons-react";
import { cn } from "cn";
import { useState } from "react";

export const FileManagerPane = ({
  allowFileUpload,
  className,
  children,
}: {
  allowFileUpload: boolean;
  className?: string;
  children: React.ReactNode;
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const { uploadFiles, isUploading, isDeleting } = useFileManager();
  return (
    <section
      onDragLeave={(event) => {
        if (!allowFileUpload) return;
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setIsDragOver(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!allowFileUpload) return;
        setIsDragOver(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!allowFileUpload || event.dataTransfer.files.length === 0) return;
        setIsDragOver(false);
        uploadFiles(event.dataTransfer.files);
      }}
      className={cn("flex min-h-0 w-full min-w-0 flex-1 flex-col", className)}
    >
      <div
        className={cn(
          "border-border bg-muted/40 text-foreground pointer-events-none absolute inset-0 z-20 flex items-center justify-center border border-dashed text-sm",
          isUploading || isDeleting ? "opacity-100" : "opacity-0",
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
        <IconCirclePlus className="mr-1" size={16} />
        Drop files here to add as attachments
      </div>
      {children}
    </section>
  );
};
