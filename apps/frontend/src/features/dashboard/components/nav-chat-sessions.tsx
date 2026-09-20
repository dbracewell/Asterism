"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { ChatSessionActionMenu } from "@/features/dashboard/components/chat-session-action-menu";
import { CollapsibleSidebarGroup } from "@/features/dashboard/components/collapsible-sidebar-group";
import { SESSIONS_OPEN_COOKIE } from "@/features/dashboard/constants";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { client } from "@/lib/api";
import { ChatInfoList } from "@/lib/client";
import {
  chatSessionBulkDeleteMutation,
  chatSessionGetManyOptions,
  chatSessionGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { IconMessage2, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export const NavChatSessions = ({
  defaultIsOpen,
}: {
  defaultIsOpen: boolean;
}) => {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { data, isPending, error } = useQuery({
    ...chatSessionGetManyOptions({
      client: client,
    }),
  });

  useSubscribeEvent({
    type: "chat-session:update",
    handler: async (payload) => {
      queryClient.setQueryData(
        chatSessionGetManyQueryKey(),
        (prev: ChatInfoList | null) => {
          if (!prev) return;
          return {
            chats: prev.chats.map((chat) => {
              if (chat.id === payload.session_id) {
                return {
                  ...chat,
                  title: payload.title,
                };
              }
              return chat;
            }),
          } as ChatInfoList;
        },
      );
    },
  });

  const router = useRouter();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { confirm, Dialog } = useConfirmationDialog({
    title: `Delete ${selectedIds.size} chat${selectedIds.size === 1 ? "" : "s"}?`,
    description: "This permanently deletes the selected chats and their messages.",
    confirmVariant: "destructive",
  });
  const bulkDelete = useMutation({
    ...chatSessionBulkDeleteMutation({ client }),
    onSuccess: async (result) => {
      const deleted = new Set(result.deleted_chat_ids);
      if (deleted.has(pathname.split("/").at(-1) ?? "")) router.push("/");
      setSelectedIds(new Set());
      setSelectionMode(false);
      await queryClient.invalidateQueries({ queryKey: chatSessionGetManyQueryKey() });
      toast.success(`Deleted ${result.deleted_chat_ids.length} chat${result.deleted_chat_ids.length === 1 ? "" : "s"}`);
    },
    onError: (mutationError) =>
      toast.error(mutationError.detail ?? "Unable to delete the selected chats."),
  });
  const toggleSelection = (chatId: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(chatId);
      else next.delete(chatId);
      return next;
    });
  };

  if (error) {
    if ("detail" in error) {
      throw Error(error.detail);
    } else {
      throw Error(JSON.stringify(error));
    }
  }

  if (isPending || data == null) {
    return (
      <CollapsibleSidebarGroup
        label="Chats"
        defaultIsOpen={defaultIsOpen}
        onMenuActionClick={() => {}}
        cookieName={SESSIONS_OPEN_COOKIE}
      >
        <></>
      </CollapsibleSidebarGroup>
    );
  }

  return (
    <CollapsibleSidebarGroup
      label="Chats"
      defaultIsOpen={defaultIsOpen}
      onMenuActionClick={() => router.push("/")}
      cookieName={SESSIONS_OPEN_COOKIE}
      className="flex-1"
    >
      <div className="flex items-center justify-between px-2 pb-1">
        {selectionMode ? (
          <>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                aria-label="Select all visible chats"
                checked={data.chats.length > 0 && selectedIds.size === data.chats.length}
                onCheckedChange={(checked) =>
                  setSelectedIds(checked ? new Set(data.chats.map((chat) => chat.id)) : new Set())
                }
              />
              {selectedIds.size} selected
            </label>
            <div className="flex gap-1">
              <Button
                aria-label="Delete selected chats"
                disabled={selectedIds.size === 0 || bulkDelete.isPending}
                onClick={async () => {
                  if (await confirm()) {
                    bulkDelete.mutate({ body: { chat_ids: [...selectedIds] } });
                  }
                }}
                size="icon-sm"
                variant="destructive"
              >
                <IconTrash />
              </Button>
              <Button
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={() => setSelectionMode(true)} size="sm" variant="ghost">
            Select
          </Button>
        )}
      </div>
      <SidebarMenu className="min-h-0 w-full gap-0.5 select-none">
        {data.chats?.map((session, index) => (
          <SidebarMenuItem
            key={session.id}
            className={cn(
              "group/item hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center justify-between rounded-md",
              index >= 20 && "group-data-[collapsible=icon]:hidden",
            )}
          >
            {selectionMode && (
              <Checkbox
                aria-label={`Select ${session.title ?? "untitled chat"}`}
                checked={selectedIds.has(session.id)}
                className="ml-2"
                onCheckedChange={(checked) => toggleSelection(session.id, checked === true)}
              />
            )}
            <SidebarMenuButton
              asChild
              isActive={pathname.endsWith(`/c/${session.id}`)}
              className={cn(
                "hover:bg-transparent! hover:text-inherit!",
                session.title == null && "bg-sidebar-border animate-pulse",
              )}
              tooltip={session.title ?? ""}
            >
              <Link href={`/c/${session.id}`}>
                <IconMessage2 className="hidden group-data-[collapsible=icon]:block" />
                <span className="group-data-[collapsible=icon]:hidden">
                  {session.title ?? ""}
                </span>
              </Link>
            </SidebarMenuButton>
            <ChatSessionActionMenu chat_id={session.id} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      <Dialog />
    </CollapsibleSidebarGroup>
  );
};
