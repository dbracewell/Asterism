import { FolderResponse } from "@/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateFolderInput } from "@/features/dashboard/components/create-folder-input";
import { useCreateNewChatSession } from "@/features/dashboard/hooks/use-create-new-chat-session";
import { useCreateNewFolder } from "@/features/dashboard/hooks/use-create-new-folder";
import { useDeleteFolder } from "@/features/dashboard/hooks/use-delete-folder";
import { cn } from "@/lib/utils";
import {
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMessage2Plus,
  IconTrash,
} from "@tabler/icons-react";
import Cookie from "js-cookie";
import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export const FolderView = ({
  folder,
  depth = 0,
}: {
  folder: FolderResponse;
  depth?: number;
}) => {
  const [foldersOpen, setFoldersOpen] = useState(
    () => new Set(JSON.parse(Cookie.get("asterism-open-folders") ?? "[]")),
  );
  const newFolder = useCreateNewFolder();
  const [isAdding, setIsAdding] = useState(false);
  const newFolderTitleRef = useRef<HTMLInputElement | null>(null);
  const [newFolderTitle, setNewFolderTitle] = useState("");
  const hasChildren = folder.children && folder.children.length > 0;
  const hasSessions = folder.sessions && folder.sessions.length > 0;
  const pathName = usePathname();

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

  const closeFolder = useCallback(() => {
    if (foldersOpen.has(folder.id)) {
      Cookie.set(
        "asterism-open-folders",
        JSON.stringify([...foldersOpen].filter((f) => f !== folder.id)),
      );
      setFoldersOpen(
        (prev) => new Set([...prev].filter((f) => f !== folder.id)),
      );
    }
  }, [foldersOpen, folder]);

  const openFolder = useCallback(() => {
    if (!foldersOpen.has(folder.id)) {
      Cookie.set(
        "asterism-open-folders",
        JSON.stringify([...foldersOpen, folder.id]),
      );
      setFoldersOpen((prev) => new Set([...prev, folder.id]));
    }
  }, [foldersOpen, folder]);

  const toggleFolder = () => {
    if (foldersOpen.has(folder.id)) {
      closeFolder();
    } else {
      openFolder();
    }
  };

  useEffect(() => {
    if (!hasChildren && !hasSessions) closeFolder();
  }, [hasChildren, hasSessions, closeFolder]);

  const addSubFolder = () => {
    setIsAdding(true);
  };

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
          <div className="group/folder hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-1 items-center justify-between gap-1 rounded border-dashed pr-1.5 pl-1">
            <button
              onClick={() => toggleFolder()}
              className="flex h-7 flex-1 items-center gap-1 truncate text-sm"
            >
              {(hasChildren || hasSessions) && foldersOpen.has(folder.id) ? (
                <IconFolderOpen className="size-4 shrink-0" />
              ) : (
                <IconFolder className="size-4 shrink-0" />
              )}
              <span className="truncate">{folder.title}</span>
            </button>
            <FolderDropDown
              folderId={folder.id}
              addSubFolder={addSubFolder}
              openFolder={openFolder}
            />
          </div>
        </div>

        <div
          className={cn("flex flex-col text-xs", isAdding ? "block" : "hidden")}
          style={{ paddingLeft: 21 + depth }}
        >
          <div className="flex h-9 items-center">
            <div className="bg-border h-full w-px" />
            <div className="bg-border h-px w-3 pr-2" />
            <CreateFolderInput
              onComplete={(v) => {
                if (v) {
                  openFolder();
                }
                setIsAdding(false);
              }}
              newFolderTitleRef={newFolderTitleRef}
              parent_folder_id={folder.id}
            />
          </div>
        </div>

        {hasChildren && foldersOpen.has(folder.id) && (
          <div className="flex flex-col">
            {folder.children!.map((child) => (
              <FolderView key={child.id} folder={child} depth={depth + 1} />
            ))}
          </div>
        )}
        {foldersOpen.has(folder.id) && (
          <div className="flex flex-col">
            {folder.sessions!.map((session) => (
              <div
                key={session.id}
                className="flex h-8 items-center"
                style={{ paddingLeft: 21 + depth }}
              >
                <div className="bg-border h-full w-px" />
                <div className="bg-border h-px w-3 pr-2" />
                <div className="flex h-7 w-full flex-1">
                  <Link
                    href={`/app/s/${session.id}`}
                    className={cn(
                      "hover:bg-sidebar-accent hover:text-accent-foreground flex w-full items-center rounded px-2 py-1.5 text-left",
                      pathName.endsWith(`/s/${session.id}`) &&
                        "bg-accent text-accent-foreground",
                    )}
                  >
                    {session.title}
                  </Link>
                </div>
              </div>
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
  openFolder,
}: {
  folderId: string;
  addSubFolder: () => void;
  openFolder: () => void;
}) => {
  const deleteFolder = useDeleteFolder();
  const createChatSession = useCreateNewChatSession();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        asChild
        className={cn("hidden group-hover/folder:block", isOpen && "block")}
      >
        <button
          className={cn(
            "hover:bg-background rounded-md p-0.5",
            isOpen && "bg-background",
          )}
        >
          <EllipsisIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => addSubFolder()}>
          <IconFolderPlus /> New Folder
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            createChatSession.mutate(folderId, {
              onSuccess: () => openFolder(),
            })
          }
        >
          <IconMessage2Plus /> New Chat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => deleteFolder.mutate(folderId)}>
          <IconTrash /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
