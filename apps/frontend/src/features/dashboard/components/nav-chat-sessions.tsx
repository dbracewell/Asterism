"use client";

import { Spinner } from "@/components/ui/spinner";
import { QueryError } from "@/components/query-error";
import { useWorkspaceScope } from "@/features/projects/hooks/use-workspace-scope";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ChatSessionActionMenu } from "@/features/dashboard/components/chat-session-action-menu";
import { CollapsibleSidebarGroup } from "@/features/dashboard/components/collapsible-sidebar-group";
import { SESSIONS_OPEN_COOKIE } from "@/features/dashboard/constants";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { client } from "@/lib/api";
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
  const workspace = useWorkspaceScope();
  return (
    <ScopedNavChatSessions
      key={workspace.projectId ?? "general"}
      defaultIsOpen={defaultIsOpen}
      workspace={workspace}
    />
  );
};

function ScopedNavChatSessions({
  defaultIsOpen,
  workspace,
}: {
  defaultIsOpen: boolean;
  workspace: ReturnType<typeof useWorkspaceScope>;
}) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isPending, error, refetch, isFetching } = useQuery({
    ...chatSessionGetManyOptions({
      client: client,
      query: { page, page_size: pageSize, project_id: workspace.projectId },
    }),
    enabled: !workspace.pending && !workspace.error,
    retry: false,
  });

  useSubscribeEvent({
    type: "chat-session:update",
    handler: async () => {
      await queryClient.invalidateQueries({
        queryKey: chatSessionGetManyQueryKey(),
      });
    },
  });

  const router = useRouter();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${selectedIds.size} chat${selectedIds.size === 1 ? "" : "s"}?`,
    description:
      "This permanently deletes the selected chats and their messages.",
    confirmVariant: "destructive",
  });
  const bulkDelete = useMutation({
    ...chatSessionBulkDeleteMutation({ client }),
    onSuccess: async (result) => {
      const deleted = new Set(result.deleted_chat_ids);
      if (deleted.has(pathname.split("/").at(-1) ?? "")) router.push("/");
      setSelectedIds(new Set());
      setSelectionMode(false);
      await queryClient.invalidateQueries({
        queryKey: chatSessionGetManyQueryKey(),
      });
      toast.success(
        `Deleted ${result.deleted_chat_ids.length} chat${result.deleted_chat_ids.length === 1 ? "" : "s"}`,
      );
    },
    onError: (mutationError) =>
      toast.error(
        mutationError.detail ?? "Unable to delete the selected chats.",
      ),
  });
  const toggleSelection = (chatId: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(chatId);
      else next.delete(chatId);
      return next;
    });
  };

  if (workspace.pending)
    return (
      <div role="status" aria-label="Loading chat workspace">
        <Spinner size={24} />
      </div>
    );

  if (workspace.error)
    return (
      <QueryError
        error={workspace.error}
        message="Could not resolve chat workspace. Reopen the chat to retry."
        retry={workspace.refetch}
        isRetrying={workspace.isFetching}
      />
    );

  if (error && !data)
    return (
      <QueryError
        error={error}
        message="Could not load workspace chats."
        retry={refetch}
        isRetrying={isFetching}
      />
    );
  if (isPending || data == null) {
    return (
      <CollapsibleSidebarGroup
        label={workspace.projectId ? "Project chats" : "General chats"}
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
      label={workspace.projectId ? "Project chats" : "General chats"}
      defaultIsOpen={defaultIsOpen}
      onMenuActionClick={() =>
        router.push(
          workspace.projectId ? `/?project_id=${workspace.projectId}` : "/",
        )
      }
      onSecondaryMenuActionClick={() => {
        setSelectionMode((active) => !active);
        setSelectedIds(new Set());
      }}
      secondaryMenuActionLabel={
        selectionMode ? "Exit chat selection" : "Select chats"
      }
      cookieName={SESSIONS_OPEN_COOKIE}
      className="flex-1"
    >
      <div className="flex items-center justify-between px-2 pb-1">
        {selectionMode ? (
          <>
            <Label className="flex items-center gap-2 text-xs">
              <Checkbox
                aria-label="Select all visible chats"
                checked={
                  data.chats.length > 0 &&
                  selectedIds.size === data.chats.length
                }
                onCheckedChange={(checked) =>
                  setSelectedIds(
                    checked
                      ? new Set(data.chats.map((chat) => chat.id))
                      : new Set(),
                  )
                }
              />
              {selectedIds.size} selected
            </Label>
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
            </div>
          </>
        ) : null}
      </div>
      {error && (
        <QueryError
          error={error}
          message="Could not refresh chats. Showing saved results."
          retry={refetch}
          isRetrying={isFetching}
        />
      )}
      {data.chats.length === 0 && (
        <p className="text-muted-foreground px-2 text-sm">No chats yet.</p>
      )}
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
                onCheckedChange={(checked) =>
                  toggleSelection(session.id, checked === true)
                }
              />
            )}
            <SidebarMenuButton
              asChild
              isActive={pathname.endsWith(`/c/${session.id}`)}
              className={cn(
                "hover:bg-transparent! hover:text-inherit!",
                session.title == null && "bg-sidebar-border animate-pulse",
              )}
              tooltip={session.title || "Untitled chat"}
            >
              <Link href={`/c/${session.id}`}>
                <IconMessage2 className="hidden group-data-[collapsible=icon]:block" />
                <span className="group-data-[collapsible=icon]:hidden">
                  {session.title || "Untitled chat"}
                </span>
              </Link>
            </SidebarMenuButton>
            <ChatSessionActionMenu chat_id={session.id} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      {(page > 1 || data.total > pageSize) && (
        <div className="flex justify-between gap-2 px-2 py-2 group-data-[collapsible=icon]:hidden">
          <Button
            aria-label="Previous chats"
            disabled={page === 1}
            size="sm"
            variant="outline"
            onClick={() => {
              setPage((value) => value - 1);
              setSelectedIds(new Set());
            }}
          >
            Previous
          </Button>
          <Button
            aria-label="Next chats"
            disabled={page * pageSize >= data.total}
            size="sm"
            variant="outline"
            onClick={() => {
              setPage((value) => value + 1);
              setSelectedIds(new Set());
            }}
          >
            Next
          </Button>
        </div>
      )}
      {dialog}
    </CollapsibleSidebarGroup>
  );
}
