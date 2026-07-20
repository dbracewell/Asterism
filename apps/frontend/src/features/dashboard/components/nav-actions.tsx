"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useChatSession } from "@/hooks/use-chat-session";
import { IconMessage2Plus } from "@tabler/icons-react";
import { SearchIcon } from "lucide-react";

export const NavActions = () => {
  const {createChatSession} = useChatSession({});

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() =>
                  createChatSession.mutate({ body: { folder_id: null } })
                }
                size="lgText"
                tooltip="New Chat"
              >
                <IconMessage2Plus /> <span>New Chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lgText" tooltip="Search">
                <a href="/inbox">
                  <SearchIcon /> <span>Search</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
