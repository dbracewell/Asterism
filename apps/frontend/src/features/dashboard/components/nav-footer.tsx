"use client";

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAppContext } from "@/features/dashboard/components/app-provider";
import { IconUserCog } from "@tabler/icons-react";
import { ChevronsUpDown } from "lucide-react";

export const NavFooter = () => {
  const { user } = useAppContext();
  return (
    <SidebarFooter className="text-md text-center">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg">
            <IconUserCog className="group-data-[state=expanded]:size-6!" />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
};
