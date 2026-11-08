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
} from "@/components/ui/dialog";
import type { UserFile } from "@/lib/client";
import { useState } from "react";

const actions = { upload: false, delete: false, regenerate: false };

type LibraryFilePickerProps = {
  excludedIds: string[];
  projectId?: string | null;
  disabled?: boolean;
  onPick: (files: UserFile[]) => Promise<void>;
};

/** Wording for pickers that are not attaching files to a chat. */
type PickerText = {
  title?: string;
  description?: string;
  action?: string;
  unavailableReason?: string;
};

export function LibraryFilePickerDialog({
  excludedIds,
  projectId,
  onPick,
  open,
  onOpenChange,
  title = "Attach library files",
  description = "Selected files are attached to this chat only.",
  action = "Attach",
  unavailableReason = "Already attached or available in this chat",
}: Omit<LibraryFilePickerProps, "disabled"> &
  PickerText & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80dvh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && (
          <div className="min-h-80 flex-1">
            <FileManager.Provider
              mode="picker"
              actions={actions}
              isSelectable={(file) =>
                !excludedIds.includes(file.id) &&
                !file.projects?.some((project) => project.id === projectId)
              }
              unavailableReason={unavailableReason}
            >
              <FileManager.Ribbon>
                <PickSelection
                  action={action}
                  onPick={async (files) => {
                    await onPick(files);
                    onOpenChange(false);
                  }}
                />
              </FileManager.Ribbon>
              <FileManager.FileList />
            </FileManager.Provider>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LibraryFilePicker({
  disabled,
  ...props
}: LibraryFilePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Attach library files
      </Button>
      <LibraryFilePickerDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}
function PickSelection({
  action,
  onPick,
}: {
  action: string;
  onPick: (files: UserFile[]) => Promise<void>;
}) {
  const { files, selectedFiles } = useFileManager();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <FileManager.RibbonSection title={action}>
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
        {action} selected ({selectedFiles.length})
      </Button>
      {error && <p role="alert">{error}</p>}
    </FileManager.RibbonSection>
  );
}
