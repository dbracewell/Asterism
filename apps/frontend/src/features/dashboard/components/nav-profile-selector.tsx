"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { IconUserPentagon } from "@tabler/icons-react";
import { ChevronsUpDown } from "lucide-react";

export const NavProfileSelector = () => {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="group-data-[state=expanded]:text-primary-foreground-foreground group-data-[state=expanded]:hover:bg-primary/50 group-data-[state=expanded]:hover:text-primary-foreground group-data-[state=expanded]:bg-sidebar-accent border"
            >
              <IconUserPentagon className="group-data-[state=expanded]:size-7!" />
              <span className="font-bold">Default Profile</span>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
