import { useConfirmationDialog } from "@/components/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateFolderInput } from "@/features/dashboard/components/create-folder-input";
import { client } from "@/lib/api";
import { Folder } from "@/lib/client";
import { folderDeleteMutation } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import {
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import Cookie from "js-cookie";
import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const FolderView = ({
  folder,
  depth = 0,
}: {
  folder: Folder;
  depth?: number;
}) => {
  const [foldersOpen, setFoldersOpen] = useState<Set<string>>(
    () => new Set(JSON.parse(Cookie.get("asterism-open-folders") ?? "[]")),
  );
  const [isAdding, setIsAdding] = useState(false);
  const newFolderTitleRef = useRef<HTMLInputElement | null>(null);
  const hasChildren = folder.children && folder.children.length > 0;
  const pathName = usePathname();
  const folderSelected = pathName.endsWith(`/folders/${folder.id}`);

  useEffect(() => {
    let timeOut = null;
    if (isAdding && newFolderTitleRef.current) {
      timeOut = setTimeout(() => newFolderTitleRef.current?.focus(), 200);
    }
    return () => {
      if (timeOut) {
        return clearTimeout(timeOut);
      }
    };
  }, [isAdding]);

  useEffect(() => {
    if (foldersOpen.has(folder.id)) {
      Cookie.set("asterism-open-folders", JSON.stringify([...foldersOpen]), {
        expires: 365,
      });
    } else {
      Cookie.set(
        "asterism-open-folders",
        JSON.stringify([...foldersOpen].filter((f) => f !== folder.id)),
        {
          expires: 365,
        },
      );
    }
  }, [foldersOpen, folder]);

  const closeFolder = useCallback(() => {
    setFoldersOpen((prev) => {
      const filtered = new Set(prev);
      filtered.delete(folder.id);
      return filtered;
    });
  }, [setFoldersOpen, folder]);

  const openFolder = useCallback(() => {
    setFoldersOpen((prev) => {
      const filtered = new Set(prev);
      if (folder.children && folder.children.length > 0) {
        filtered.add(folder.id);
      }
      return filtered;
    });
  }, [setFoldersOpen, folder]);

  const forceOpenFolder = useCallback(
    (folder_id: string) => {
      if (!foldersOpen.has(folder.id)) {
        setFoldersOpen((prev) => new Set([...prev, folder_id]));
        Cookie.set(
          "asterism-open-folders",
          JSON.stringify([...foldersOpen, folder_id]),
          {
            expires: 365,
          },
        );
      }
    },
    [folder, foldersOpen],
  );

  const toggleFolder = useCallback(() => {
    if (foldersOpen.has(folder.id)) {
      closeFolder();
    } else {
      openFolder();
    }
  }, [closeFolder, openFolder, foldersOpen, folder.id]);

  useEffect(() => {
    if (!hasChildren) closeFolder();
  }, [hasChildren, closeFolder]);

  const addSubFolder = useCallback(() => {
    setIsAdding(true);
  }, []);

  return (
    <div
      className="flex min-w-0 flex-col text-sm!"
      style={{ paddingLeft: (depth > 0 ? 20 : 0) + depth }}
    >
      <div className={cn("flex flex-col text-xs", depth > 0 && "border-l")}>
        <div className="flex items-center">
          {depth > 0 ? (
            <>
              <div className="bg-border h-full w-px" />
              <div className="bg-border h-px w-3 pr-2" />
            </>
          ) : (
            <div className="h-px w-3 pr-2" />
          )}
          <div
            className={cn(
              "group/folder hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-1 items-center justify-between gap-1 rounded border-dashed pr-1.5 pl-1",
              folderSelected &&
                "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <button
              aria-label={`${foldersOpen.has(folder.id) ? "Collapse" : "Expand"} ${folder.title}`}
              className={"flex size-7 shrink-0 items-center justify-center"}
              onClick={toggleFolder}
            >
              {foldersOpen.has(folder.id) ? (
                <IconFolderOpen className="size-4" />
              ) : (
                <IconFolder className="size-4" />
              )}
            </button>
            <Link
              className="flex h-7 min-w-0 flex-1 items-center truncate text-sm"
              href={`/folders/${folder.id}`}
            >
              <span className="truncate">{folder.title}</span>
            </Link>
            <FolderDropDown folderId={folder.id} addSubFolder={addSubFolder} />
          </div>
        </div>

        <div
          className={cn("flex flex-col text-xs", isAdding ? "block" : "hidden")}
          style={{ paddingLeft: 21 + depth }}
        >
          <div className="flex h-9 items-center">
            <div className="bg-border h-full w-px" />
            <div className="bg-border h-px w-3 pr-2" />
            <div className="pr-2">
              <CreateFolderInput
                onComplete={(v) => {
                  if (v) {
                    forceOpenFolder(folder.id);
                  }
                  setIsAdding(false);
                }}
                newFolderTitleRef={newFolderTitleRef}
                parent_folder_id={folder.id}
              />
            </div>
          </div>
        </div>

        {hasChildren && foldersOpen.has(folder.id) && (
          <div className="flex flex-col">
            {folder.children!.map((child) => (
              <FolderView key={child.id} folder={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const FolderDropDown = ({
  folderId,
  addSubFolder,
}: {
  folderId: string;
  addSubFolder: () => void;
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const { confirm, Dialog } = useConfirmationDialog({
    title: "Delete folder?",
    description: "This permanently deletes the folder and its subfolders.",
    confirmVariant: "destructive",
  });
  const deleteFolder = useMutation({
    ...folderDeleteMutation({
      client: client,
    }),
    onSuccess: async (data) => {
      if (pathname === `/folders/${folderId}`) router.push("/");
      toast.success(`Successfully deleted "${data.title}" folder`);
    },
    onError: (error) => {
      toast.error(error.detail ?? "Unknow Error");
    },
  });

  const [isOpen, setIsOpen] = useState(false);
  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        asChild
        className={cn("hidden group-hover/folder:block", isOpen && "block")}
      >
        <button
          className={cn(
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md p-0.5",
            isOpen && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
        >
          <EllipsisIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => addSubFolder()}>
          <IconFolderPlus /> New Folder
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/folders/${folderId}`}>
            <IconFolderOpen /> Open folder
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            if (await confirm()) {
              deleteFolder.mutate({
                path: {
                  folder_id: folderId,
                },
              });
            }
          }}
        >
          <IconTrash /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
      <Dialog />
    </DropdownMenu>
  );
};
