"use client";

import { NavListSkeleton } from "@/components/loading-skeletons";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { QueryError } from "@/components/query-error";
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
import {
  GENERAL_QUICK_CHATS_OPEN_COOKIE,
  SESSIONS_OPEN_COOKIE,
} from "@/features/dashboard/constants";
import { useWorkspaceScope } from "@/features/projects/hooks/use-workspace-scope";
import { ProjectAccentDot } from "@/features/projects/project-accent";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { client } from "@/lib/api";
import {
  chatSessionBulkDeleteMutation,
  chatSessionGetManyOptions,
  chatSessionGetManyQueryKey,
  projectGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MessageSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export const NavChatSessions = ({
  defaultIsOpen,
  general = false,
}: {
  defaultIsOpen: boolean;
  general?: boolean;
}) => {
  const workspace = useWorkspaceScope();
  const scope = general
    ? { ...workspace, projectId: null, pending: false, error: null }
    : workspace;
  return (
    <ScopedNavChatSessions
      key={scope.projectId ?? "general"}
      defaultIsOpen={defaultIsOpen}
      workspace={scope}
      general={general}
      activeGeneral={
        !workspace.pending && !workspace.error && !workspace.projectId
      }
    />
  );
};

function ScopedNavChatSessions({
  defaultIsOpen,
  workspace,
  general,
  activeGeneral,
}: {
  defaultIsOpen: boolean;
  workspace: ReturnType<typeof useWorkspaceScope>;
  general: boolean;
  activeGeneral: boolean;
}) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [page, setPage] = useState(1);
  const pageSize = general ? 5 : 50;
  const { data, isPending, error, refetch, isFetching } = useQuery({
    ...chatSessionGetManyOptions({
      client: client,
      query: { page, page_size: pageSize, project_id: workspace.projectId },
    }),
    enabled: !workspace.pending && !workspace.error,
    retry: false,
  });

  const project = useQuery({
    ...projectGetOneOptions({
      client,
      path: { project_id: workspace.projectId ?? "" },
    }),
    enabled: !!workspace.projectId && !workspace.pending && !workspace.error,
    retry: false,
  });
  const label = general
    ? "General"
    : workspace.projectId
      ? (project.data?.name ??
        (project.isPending ? "Loading project…" : "Project unavailable"))
      : "General chats";

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
  // Membership can shrink after either a row action or a bulk deletion.
  const lastPage = data ? Math.max(1, Math.ceil(data.total / pageSize)) : page;
  if (page > lastPage) {
    setPage(lastPage);
    setSelectedIds(new Set());
  }

  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${selectedIds.size} chat${selectedIds.size === 1 ? "" : "s"}?`,
    description:
      "This permanently deletes the selected chats and their messages.",
    confirmVariant: "destructive",
  });
  const bulkDelete = useMutation({
    ...chatSessionBulkDeleteMutation({ client }),
    meta: {
      invalidates: [chatSessionGetManyQueryKey()],
    },
    onSuccess: (result) => {
      const deleted = new Set(result.deleted_chat_ids);
      if (deleted.has(pathname.split("/").at(-1) ?? "")) router.push("/");
      setSelectedIds(new Set());
      setSelectionMode(false);
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
    return <NavListSkeleton label="Loading chat workspace" rows={5} />;

  if (workspace.error)
    return (
      <QueryError
        error={workspace.error}
        message="Could not resolve chat workspace. Reopen the chat to retry."
        retry={workspace.refetch}
        isRetrying={workspace.isFetching}
      />
    );

  return (
    <CollapsibleSidebarGroup
      label={label}
      labelAdornment={
        !general && <ProjectAccentDot accent={project.data?.accent ?? null} />
      }
      href={general ? "/general" : undefined}
      isActive={
        general &&
        (pathname === "/general" ||
          pathname === "/" ||
          pathname.startsWith("/c/")) &&
        activeGeneral
      }
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
      cookieName={
        general ? GENERAL_QUICK_CHATS_OPEN_COOKIE : SESSIONS_OPEN_COOKIE
      }
      className={general ? "p-0" : "flex-1"}
    >
      <div className="flex shrink-0 items-center justify-between px-2 pb-1 group-data-[collapsible=icon]:hidden">
        {selectionMode ? (
          <>
            <Label className="flex items-center gap-2 text-xs">
              <Checkbox
                aria-label="Select all visible chats"
                checked={
                  (data?.chats.length ?? 0) > 0 &&
                  selectedIds.size === (data?.chats.length ?? 0)
                }
                onCheckedChange={(checked) =>
                  setSelectedIds(
                    checked
                      ? new Set(data?.chats.map((chat) => chat.id))
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
                <Trash2Icon />
              </Button>
            </div>
          </>
        ) : null}
      </div>
      {project.error && (
        <QueryError
          error={project.error}
          message={
            project.data
              ? "Could not refresh project name."
              : "Could not load project name."
          }
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
      {isPending && <NavListSkeleton label="Loading chats" rows={5} />}
      {error && (
        <QueryError
          error={error}
          message={
            data
              ? "Could not refresh chats. Showing saved results."
              : "Could not load workspace chats."
          }
          retry={refetch}
          isRetrying={isFetching}
        />
      )}
      {data && data.chats.length === 0 && (
        <p className="text-muted-foreground px-2 text-sm group-data-[collapsible=icon]:hidden">
          No chats yet.
        </p>
      )}
      <SidebarMenu
        className={cn(
          "min-h-0 w-full shrink-0 gap-0.5 select-none",
          general &&
            "border-sidebar-border ml-3 w-auto border-l pl-2 group-data-[collapsible=icon]:hidden",
        )}
      >
        {data?.chats?.map((session, index) => (
          <SidebarMenuItem
            key={session.id}
            className={cn(
              "group/item hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-control flex w-full items-center justify-between",
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
                <MessageSquareIcon className="hidden group-data-[collapsible=icon]:block" />
                <span className="group-data-[collapsible=icon]:hidden">
                  {session.title || "Untitled chat"}
                </span>
              </Link>
            </SidebarMenuButton>
            <ChatSessionActionMenu chat={session} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      {(page > 1 || (data?.total ?? 0) > pageSize) && (
        <div className="flex shrink-0 justify-between gap-2 px-2 py-2 group-data-[collapsible=icon]:hidden">
          <Button
            aria-label="Previous chats"
            disabled={page === 1 || isFetching}
            size="sm"
            variant={general ? "ghost" : "outline"}
            onClick={() => {
              setPage((value) => value - 1);
              setSelectedIds(new Set());
            }}
          >
            {general ? <ChevronUpIcon /> : "Previous"}
          </Button>
          <Button
            aria-label="Next chats"
            disabled={page * pageSize >= (data?.total ?? 0) || isFetching}
            size="sm"
            variant={general ? "ghost" : "outline"}
            onClick={() => {
              setPage((value) => value + 1);
              setSelectedIds(new Set());
            }}
          >
            {general ? <ChevronDownIcon /> : "Next"}
          </Button>
        </div>
      )}
      {dialog}
    </CollapsibleSidebarGroup>
  );
}
