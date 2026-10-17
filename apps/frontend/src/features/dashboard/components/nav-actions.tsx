"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { IconMessage2Plus } from "@tabler/icons-react";
import { FilesIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useWorkspaceScope } from "@/features/projects/hooks/use-workspace-scope";
import { usePathname } from "next/navigation";

export const NavActions = () => {
  const pathname = usePathname();
  const { projectId } = useWorkspaceScope();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lgText" tooltip="New Chat" asChild>
              <Link href={projectId ? `/?project_id=${projectId}` : "/"}>
                <IconMessage2Plus /> <span>New Chat</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lgText"
              tooltip="Search"
              isActive={pathname === "/search"}
            >
              <Link href="/search">
                <SearchIcon /> <span>Search</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lgText"
              tooltip="Files"
              isActive={pathname === "/files"}
            >
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
