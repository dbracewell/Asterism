"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SidebarMenuAction } from "@/components/ui/sidebar";
import { useChatSessionCrud } from "@/features/chat/hooks/use-chat-session-crud";
import { MoveChatDialog } from "@/features/projects/components/move-chat-dialog";
import { client } from "@/lib/api";
import type { ChatInfo } from "@/lib/client";
import { chatSessionUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import {
  EllipsisIcon,
  FolderInputIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

/** Rename, move and delete for one chat, in the sidebar row or the header. */
export const ChatSessionActionMenu = ({
  chat,
  variant = "sidebar",
}: {
  chat: ChatInfo;
  variant?: "sidebar" | "header";
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "move" | null>(null);
  const { deleteChatSession, isDeleting } = useChatSessionCrud();
  const { confirm, dialog: confirmDialog } = useConfirmationDialog({
    title: "Delete chat?",
    description: "This permanently deletes this chat and its messages.",
    confirmVariant: "destructive",
  });
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          {variant === "header" ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Chat actions"
              className="size-11 shrink-0 md:size-8"
            >
              <EllipsisIcon className="size-4" />
            </Button>
          ) : (
            <SidebarMenuAction
              aria-label="Chat actions"
              className={cn(
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 focus-visible:opacity-100",
                isOpen && "opacity-100",
              )}
            >
              <EllipsisIcon />
            </SidebarMenuAction>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              <PencilIcon /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("move")}>
              <FolderInputIcon /> Move
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={isDeleting}
              onClick={async () => {
                if (await confirm()) {
                  deleteChatSession({
                    path: {
                      chat_id: chat.id,
                    },
                  });
                }
              }}
            >
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
        {confirmDialog}
      </DropdownMenu>
      <RenameChatDialog
        chat={chat}
        open={dialog === "rename"}
        onOpenChange={closeDialog}
      />
      <MoveChatDialog
        info={chat}
        open={dialog === "move"}
        onOpenChange={closeDialog}
      />
    </>
  );
};

function RenameChatDialog({
  chat,
  open,
  onOpenChange,
}: {
  chat: ChatInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
          <DialogDescription>
            The title appears in the sidebar, search and header.
          </DialogDescription>
        </DialogHeader>
        <RenameChatForm
          key={`${chat.id}:${chat.title ?? ""}`}
          chat={chat}
          onRenamed={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameChatForm({
  chat,
  onRenamed,
}: {
  chat: ChatInfo;
  onRenamed: () => void;
}) {
  const [title, setTitle] = useState(chat.title ?? "");
  const rename = useMutation({
    ...chatSessionUpdateMutation({ client }),
    onSuccess: onRenamed,
  });
  const trimmed = title.trim();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate({ path: { chat_id: chat.id }, body: { title: trimmed } });
      }}
    >
      <Field>
        <FieldLabel htmlFor={`chat-title-${chat.id}`}>Chat title</FieldLabel>
        <Input
          id={`chat-title-${chat.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={rename.isPending}
        />
      </Field>
      {rename.error && (
        <p role="alert">{rename.error.detail ?? "Could not rename chat."}</p>
      )}
      <DialogFooter>
        <Button
          type="submit"
          disabled={
            rename.isPending || !trimmed || trimmed === (chat.title ?? "")
          }
        >
          {rename.isPending ? "Saving…" : "Save title"}
        </Button>
      </DialogFooter>
    </form>
  );
}
