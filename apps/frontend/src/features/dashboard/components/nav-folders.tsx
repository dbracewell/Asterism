"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Cookie from "js-cookie";
import { ChevronDownIcon, ChevronRightIcon, EllipsisIcon } from "lucide-react";
import React from "react";

export const NavFolders = ({ defaultIsOpen }: { defaultIsOpen: boolean }) => {
  const [isOpen, setIsOpen] = React.useState(defaultIsOpen);
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    Cookie.set("asterism-folder-open", `${open}`, { path: "/", expires: 365 });
  };
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <Collapsible
        suppressHydrationWarning
        open={isOpen}
        onOpenChange={handleOpenChange}
      >
        <div className="group/folder flex">
          <CollapsibleTrigger className="w-full">
            <SidebarGroupLabel className="group-hover/folder:bg-sidebar-accent w-full flex-1 cursor-pointer select-none">
              {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}{" "}
              <span className="ml-2">Folders</span>
            </SidebarGroupLabel>
          </CollapsibleTrigger>
          <SidebarMenuAction className="group-hover/folder:bg-sidebar-accent mr-2 opacity-0 group-hover/folder:opacity-100">
            +
          </SidebarMenuAction>
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {Array.from({ length: 100 }).map((_, i) => (
                <SidebarMenuItem
                  key={i}
                  className="group/item hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative rounded-md"
                >
                  <SidebarMenuButton
                    asChild
                    className="hover:bg-transparent! hover:text-inherit!"
                  >
                    <a href="/calendar">
                      <span>A nice message from your chatbot</span>
                    </a>
                  </SidebarMenuButton>
                  <SidebarMenuAction className="hover:bg-sidebar-accent-hover!">
                    <EllipsisIcon />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
};
