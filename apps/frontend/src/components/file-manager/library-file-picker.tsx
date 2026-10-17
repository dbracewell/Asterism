"use client";

import * as FileManager from "@/components/file-manager";
import { useFileManager } from "./context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { UserFile } from "@/lib/client";
import { useState } from "react";

const actions = { upload: false, delete: false, regenerate: false };
export function LibraryFilePicker({
  excludedIds,
  disabled,
  projectId,
  onPick,
}: {
  excludedIds: string[];
  projectId?: string | null;
  disabled?: boolean;
  onPick: (files: UserFile[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
          Attach library files
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Attach library files to this chat</DialogTitle>
          <DialogDescription>
            Choose files for the next message. They stay local to this chat
            unless you explicitly add them to a project.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <FileManager.Provider
            mode="picker"
            actions={actions}
            isSelectable={(file) =>
              !excludedIds.includes(file.id) &&
              !file.projects?.some((project) => project.id === projectId)
            }
            unavailableReason="Already attached or available in this chat"
          >
            <FileManager.Ribbon>
              <PickSelection
                onPick={async (files) => {
                  await onPick(files);
                  setOpen(false);
                }}
              />
            </FileManager.Ribbon>
            <FileManager.FileList />
          </FileManager.Provider>
        )}
      </DialogContent>
    </Dialog>
  );
}
function PickSelection({
  onPick,
}: {
  onPick: (files: UserFile[]) => Promise<void>;
}) {
  const { files, selectedFiles } = useFileManager();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <FileManager.RibbonSection title="Attach">
      <Button
        type="button"
        disabled={pending || !selectedFiles.length}
        onClick={async () => {
          setPending(true);
          setError(undefined);
          try {
            await onPick(
              files.filter((file) => selectedFiles.includes(file.filename)),
            );
          } catch {
            setError(
              "Could not stage these files. Retry, or close the picker and review your draft.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        Attach selected ({selectedFiles.length})
      </Button>
      {error && <p role="alert">{error}</p>}
    </FileManager.RibbonSection>
  );
}
