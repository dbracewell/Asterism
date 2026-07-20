import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { AppSidebarHeader } from "@/features/dashboard/components/app-sidebar-header";
import { NavActions } from "@/features/dashboard/components/nav-actions";
import { NavChatSessions } from "@/features/dashboard/components/nav-chat-sessions";
import { NavFolders } from "@/features/dashboard/components/nav-folders";
import { NavFooter } from "@/features/dashboard/components/nav-footer";
import { NavProfileSelector } from "@/features/dashboard/components/nav-profile-selector";

export const AppSidebar = async ({
  sidebarWidth,
  navFolderOpen,
  navSessionsOpen,
}: {
  sidebarWidth?: string;
  navFolderOpen: boolean;
  navSessionsOpen: boolean;
}) => {
  return (
    <Sidebar width={sidebarWidth} className="overflow-hidden! border-r">
      <AppSidebarHeader />
      <SidebarContent className="flex min-h-0 flex-1 flex-col pt-2">
        <NavProfileSelector />
        <NavActions />
        <div className="flex min-h-0 flex-1 flex-col">
          <NavFolders defaultIsOpen={navFolderOpen} />
          <NavChatSessions defaultIsOpen={navSessionsOpen} />
        </div>
      </SidebarContent>
      <NavFooter />
    </Sidebar>
  );
};
