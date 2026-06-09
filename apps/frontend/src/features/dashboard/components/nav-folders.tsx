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
} from "@/components/ui/sidebar";
import { CreateFolderInput } from "@/features/dashboard/components/create-folder-input";
import { FolderView } from "@/features/dashboard/components/folder-view";
import { useFolderList } from "@/features/dashboard/hooks/use-folder-list";
import { cn } from "@/lib/utils";
import Cookie from "js-cookie";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import React, { useEffect } from "react";

export const NavFolders = ({ defaultIsOpen }: { defaultIsOpen: boolean }) => {
  const [isOpen, setIsOpen] = React.useState(defaultIsOpen);
  const [isAdding, setIsAdding] = React.useState(false);
  const newFolderTitleRef = React.useRef<HTMLInputElement | null>(null);
  const { folderList } = useFolderList();

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    Cookie.set("asterism-folder-open", `${open}`, { path: "/", expires: 365 });
  };

  useEffect(() => {
    if (isAdding && newFolderTitleRef.current) {
      newFolderTitleRef.current.focus();
    }
  }, [isAdding]);

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
          <SidebarMenuAction
            onClick={() => {
              handleOpenChange(true);
              setIsAdding(true);
            }}
            className="group-hover/folder:bg-sidebar-accent mr-2 opacity-0 group-hover/folder:opacity-100"
          >
            +
          </SidebarMenuAction>
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="flex flex-col">
              <div
                className={cn("gap-1 py-1 pl-4", isAdding ? "block" : "hidden")}
              >
                <CreateFolderInput
                  newFolderTitleRef={newFolderTitleRef}
                  onComplete={() => {
                    setIsAdding(false);
                  }}
                />
              </div>
              {folderList?.map((folder) => (
                <FolderView folder={folder} key={folder.id} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
};
