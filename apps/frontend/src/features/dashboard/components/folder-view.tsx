import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatSessionActionMenu } from "@/features/dashboard/components/chat-session-action-menu";
import { CreateFolderInput } from "@/features/dashboard/components/create-folder-input";
import { useChatSession } from "@/hooks/use-chat-session";
import { client } from "@/lib/api";
import { FolderModel } from "@/lib/client";
import { folderDeleteMutation } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import {
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMessage2Plus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import Cookie from "js-cookie";
import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const FolderView = ({
  folder,
  depth = 0,
}: {
  folder: FolderModel;
  depth?: number;
}) => {
  const [foldersOpen, setFoldersOpen] = useState<Set<string>>(
    () => new Set(JSON.parse(Cookie.get("asterism-open-folders") ?? "[]")),
  );
  const [isAdding, setIsAdding] = useState(false);
  const newFolderTitleRef = useRef<HTMLInputElement | null>(null);
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
  }, [foldersOpen, folder.id]);

  const closeFolder = useCallback(() => {
    setFoldersOpen((prev) => {
      const filtered = new Set(prev);
      filtered.delete(folder.id);
      return filtered;
    });
  }, [setFoldersOpen, folder.id]);

  const openFolder = useCallback(() => {
    setFoldersOpen((prev) => {
      const filtered = new Set(prev);
      if (
        (folder.sessions && folder.sessions.length > 0) ||
        (folder.children && folder.children.length > 0)
      ) {
        filtered.add(folder.id);
      }
      return filtered;
    });
  }, [setFoldersOpen, folder.id, folder.children, folder.sessions]);

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
    [folder.id, foldersOpen],
  );

  const toggleFolder = useCallback(() => {
    if (foldersOpen.has(folder.id)) {
      closeFolder();
    } else {
      openFolder();
    }
  }, [closeFolder, openFolder, foldersOpen, folder.id]);

  useEffect(() => {
    if (!hasChildren && !hasSessions) closeFolder();
  }, [hasChildren, hasSessions, closeFolder]);

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
          <div className="group/folder hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-1 items-center justify-between gap-1 rounded border-dashed pr-1.5 pl-1">
            <button
              onClick={() => toggleFolder()}
              className="flex h-7 flex-1 items-center gap-1 truncate text-sm"
            >
              {foldersOpen.has(folder.id) ? (
                <IconFolderOpen className="size-4 shrink-0" />
              ) : (
                <IconFolder className="size-4 shrink-0" />
              )}
              <span className="truncate">{folder.title}</span>
            </button>
            <FolderDropDown
              folderId={folder.id}
              addSubFolder={addSubFolder}
              openFolder={forceOpenFolder}
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
                  forceOpenFolder(folder.id);
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
                <div
                  className={cn(
                    "group/item hover:bg-sidebar-accent text-sidebar-accent-foreground flex h-7 w-full flex-1 items-center justify-between rounded px-2 py-1.5 text-left",
                    pathName.endsWith(`/c/${session.id}`) &&
                      "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <Link href={`/c/${session.id}`} className="flex-1 truncate">
                    {session.title}
                  </Link>
                  <ChatSessionActionMenu button session_id={session.id} />
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
  openFolder: (folder_id: string) => void;
}) => {
  const deleteFolder = useMutation({
    ...folderDeleteMutation({
      client: client,
    }),
    onSuccess: async (data) => {
      toast.success(`Successfully deleted "${data.title}" folder`);
    },
    onError: (error) => {
      toast.error(error.detail ?? "Unknow Error");
    },
  });

  const { createChatSession } = useChatSession({
    onSuccess: () => openFolder(folderId),
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
            createChatSession.mutate({
              body: {
                folder_id: folderId,
              },
            })
          }
        >
          <IconMessage2Plus /> New Chat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            deleteFolder.mutate({
              path: {
                folder_id: folderId,
              },
            })
          }
        >
          <IconTrash /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
