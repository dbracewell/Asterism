"use client";

import { SidebarMenu } from "@/components/ui/sidebar";
import { CollapsibleSidebarGroup } from "@/features/dashboard/components/collapsible-sidebar-group";
import { CreateFolderInput } from "@/features/dashboard/components/create-folder-input";
import { FolderView } from "@/features/dashboard/components/folder-view";
import { FOLDER_OPEN_COOKIE } from "@/features/dashboard/constants";
import { client } from "@/lib/api";
import { folderGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect } from "react";

export const NavFolders = ({ defaultIsOpen }: { defaultIsOpen: boolean }) => {
  const [isAdding, setIsAdding] = React.useState(false);
  const newFolderTitleRef = React.useRef<HTMLInputElement | null>(null);

  const {
    data: folderList,
    isPending,
    error,
  } = useQuery({
    ...folderGetManyOptions({
      client: client,
    }),
  });

  useEffect(() => {
    if (isAdding && newFolderTitleRef.current) {
      newFolderTitleRef.current.focus();
    }
  }, [isAdding]);

  if (error) {
    throw Error(`Error Code ${error.code}`);
  }

  if (isPending || folderList == null) {
    return (
      <CollapsibleSidebarGroup
        label="Folders"
        defaultIsOpen={defaultIsOpen}
        onMenuActionClick={() => {}}
        cookieName={FOLDER_OPEN_COOKIE}
        className="max-h-1/2"
      >
        <></>
      </CollapsibleSidebarGroup>
    );
  }

  return (
    <CollapsibleSidebarGroup
      label="Folders"
      defaultIsOpen={defaultIsOpen}
      onMenuActionClick={() => {
        setIsAdding(true);
      }}
      cookieName={FOLDER_OPEN_COOKIE}
    >
      <SidebarMenu className="min-h-0 gap-0.5">
        <div className={cn("gap-1 py-1 pl-4", isAdding ? "block" : "hidden")}>
          <CreateFolderInput
            newFolderTitleRef={newFolderTitleRef}
            onComplete={() => {
              setIsAdding(false);
            }}
          />
        </div>
        <div className="no-scrollbar mask-fade-on-scroll overflow-y-auto">
          {folderList.folders.map((folder) => (
            <FolderView folder={folder} key={folder.id} />
          ))}
        </div>
      </SidebarMenu>
    </CollapsibleSidebarGroup>
  );
};
