"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { IconMessage2Plus } from "@tabler/icons-react";
import { DatabaseIcon, FilesIcon, SearchIcon } from "lucide-react";
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
              <Link href="/search">
                <SearchIcon /> <span>Search</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lgText" tooltip="Knowledge bases">
              <Link href="/knowledge">
                <DatabaseIcon /> <span>Knowledge</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lgText" tooltip="Files">
              <Link href="/files">
                <FilesIcon /> <span>Files</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
