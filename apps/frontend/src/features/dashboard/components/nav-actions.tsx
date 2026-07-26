"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { IconMessage2Plus } from "@tabler/icons-react";
import { SearchIcon } from "lucide-react";
import Link from "next/link";

export const NavActions = () => {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lgText" tooltip="New Chat" asChild>
              <Link href="/">
                <IconMessage2Plus /> <span>New Chat</span>
              </Link>
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
