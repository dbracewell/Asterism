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
import { useChatSessionList } from "@/features/dashboard/hooks/use-chat-session-list";
import { useCreateNewChatSession } from "@/features/dashboard/hooks/use-create-new-chat-session";
import Cookie from "js-cookie";
import { ChevronDownIcon, ChevronRightIcon, EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { toast } from "sonner";

export const NavChatSessions = ({
  defaultIsOpen,
}: {
  defaultIsOpen: boolean;
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultIsOpen);
  const { sessionList, errorLoadingSessionList, isSessionListLoading } =
    useChatSessionList();
  const newChatSession = useCreateNewChatSession();
  const pathname = usePathname();

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    Cookie.set("asterism-sessions-open", `${open}`, {
      path: "/",
      expires: 365,
    });
  };

  if (errorLoadingSessionList) {
    toast.error(errorLoadingSessionList.message);
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <Collapsible
        open={isOpen}
        onOpenChange={handleOpenChange}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="group/folder flex">
          <CollapsibleTrigger className="w-full">
            <SidebarGroupLabel className="group-hover/folder:bg-sidebar-accent w-full flex-1 cursor-pointer select-none">
              {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}{" "}
              <span className="ml-2">Chats</span>
            </SidebarGroupLabel>
          </CollapsibleTrigger>
          <SidebarMenuAction
            onClick={() => newChatSession.mutate()}
            className="group-hover/folder:bg-sidebar-accent mr-2 opacity-0 group-hover/folder:opacity-100"
          >
            +
          </SidebarMenuAction>
        </div>
        <CollapsibleContent className="pt-1">
          <SidebarGroupContent>
            {isSessionListLoading && <>Loading</>}
            <SidebarMenu className="gap-0.5">
              {sessionList?.map((session) => (
                <SidebarMenuItem
                  key={session.id}
                  className="group/item hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative rounded-md"
                >
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.endsWith(`/s/${session.id}`)}
                    className="hover:bg-transparent! hover:text-inherit!"
                  >
                    <Link href={`/app/s/${session.id}`}>
                      <span>{session.title}</span>
                    </Link>
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
