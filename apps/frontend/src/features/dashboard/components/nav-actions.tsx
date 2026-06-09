"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCreateNewChatSession } from "@/features/dashboard/hooks/use-create-new-chat-session";
import { IconMessage2Plus } from "@tabler/icons-react";
import { SearchIcon } from "lucide-react";

export const NavActions = () => {
  const newChatSession = useCreateNewChatSession();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <TooltipProvider>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => newChatSession.mutate({})}
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
          </TooltipProvider>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
