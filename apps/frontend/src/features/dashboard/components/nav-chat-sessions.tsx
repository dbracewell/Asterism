"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ChatSessionActionMenu } from "@/features/dashboard/components/chat-session-action-menu";
import { CollapsibleSidebarGroup } from "@/features/dashboard/components/collapsible-sidebar-group";
import { SESSIONS_OPEN_COOKIE } from "@/features/dashboard/constants";
import { client } from "@/lib/api";
import {
  chatSessionGetManyOptions,
  chatSessionGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { cn } from "@/lib/utils";
import { IconMessage2 } from "@tabler/icons-react";
import { ChatModelList } from "@/lib/client";

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
        (prev: ChatModelList | null) => {
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
          } as ChatModelList;
        },
      );
    },
  });

  const router = useRouter();

  if (error) {
    throw Error(error.detail);
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
      <SidebarMenu className="min-h-0 w-full gap-0.5 select-none">
        {data.chats?.map((session, index) => (
          <SidebarMenuItem
            key={session.id}
            className={cn(
              "group/item hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center justify-between rounded-md",
              index >= 20 && "group-data-[collapsible=icon]:hidden",
            )}
          >
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
            <ChatSessionActionMenu session_id={session.id} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </CollapsibleSidebarGroup>
  );
};
