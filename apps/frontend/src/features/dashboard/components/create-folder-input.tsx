"use client";

import { Input } from "@/components/ui/input";
import { useCreateNewFolder } from "@/features/dashboard/hooks/use-create-new-folder";
import { IconFolderPlus } from "@tabler/icons-react";
import { RefObject, useState } from "react";

export const CreateFolderInput = ({
  parent_folder_id,
  onComplete,
  newFolderTitleRef,
}: {
  newFolderTitleRef: RefObject<HTMLInputElement | null>;
  parent_folder_id?: string;
  onComplete: (addedFolder: boolean) => void;
}) => {
  const newFolder = useCreateNewFolder();
  const [newFolderTitle, setNewFolderTitle] = useState("");

  return (
    <div className="bg-input/30 ring-ring flex flex-1 items-center gap-2 rounded border p-px ring-1 outline-1">
      <IconFolderPlus className="text-muted-foreground size-6" />
      <Input
        className="border-0 bg-transparent! p-0! text-sm! ring-0 outline-0 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-0"
        ref={newFolderTitleRef}
        value={newFolderTitle}
        onChange={(e) => setNewFolderTitle(e.target.value)}
        onBlur={() => {
          onComplete(false);
          setNewFolderTitle("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            newFolder.mutate({
              title: newFolderTitle,
              parent_folder_id,
            });
            setNewFolderTitle("");
            onComplete(true);
            return;
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onComplete(false);
            setNewFolderTitle("");
            return;
          }
        }}
      />
    </div>
  );
};
