"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ChatSessionActionMenu } from "@/features/dashboard/components/chat-session-action-menu";
import { CollapsibleSidebarGroup } from "@/features/dashboard/components/collapsible-sidebar-group";
import { SESSIONS_OPEN_COOKIE } from "@/features/dashboard/constants";
import { useChatSessionCrud } from "@/hooks/use-chat-session-crud";
import { client } from "@/lib/api";
import { chatSessionGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";

export const NavChatSessions = ({
  defaultIsOpen,
}: {
  defaultIsOpen: boolean;
}) => {
  const pathname = usePathname();
  const { data, isPending, error, refetch } = useQuery({
    ...chatSessionGetManyOptions({
      client: client,
    }),
  });

  useSubscribeEvent({
    type: "chat-session:update",
    handler: async () => {
      await refetch();
    },
  });

  const { createChatSession } = useChatSessionCrud();

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
      onMenuActionClick={() => createChatSession({ body: { folder_id: null } })}
      cookieName={SESSIONS_OPEN_COOKIE}
      className="flex-1"
    >
      <SidebarMenu className="min-h-0 gap-0.5 select-none">
        {data.sessions?.map((session) => (
          <SidebarMenuItem
            key={session.id}
            className="group/item hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center justify-between rounded-md"
          >
            <SidebarMenuButton
              asChild
              isActive={pathname.endsWith(`/c/${session.id}`)}
              className="hover:bg-transparent! hover:text-inherit!"
            >
              <Link href={`/c/${session.id}`}>
                <span>{session.title}</span>
              </Link>
            </SidebarMenuButton>
            <ChatSessionActionMenu session_id={session.id} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </CollapsibleSidebarGroup>
  );
};
