"use client";

import { FileManager } from "@/components/file-manager";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";

export function AddFilesDialog({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">Add files</Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add files to this knowledge base</DialogTitle>
          <DialogDescription>
            Select library files to add, or upload new ones first. Files already
            in this knowledge base cannot be selected.
          </DialogDescription>
        </DialogHeader>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <FileManager
            allowFileUpload
            picker={{ knowledgeBaseId, onAdded: () => setOpen(false) }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
