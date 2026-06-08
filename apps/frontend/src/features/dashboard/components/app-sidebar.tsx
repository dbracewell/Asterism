import { Sidebar, SidebarContent, SidebarRail } from "@/components/ui/sidebar";
import { AppSidebarHeader } from "@/features/dashboard/components/app-sidebar-header";
import { NavActions } from "@/features/dashboard/components/nav-actions";
import { NavChatSessions } from "@/features/dashboard/components/nav-chat-sessions";
import { NavFolders } from "@/features/dashboard/components/nav-folders";
import { NavFooter } from "@/features/dashboard/components/nav-footer";
import { NavProfileSelector } from "@/features/dashboard/components/nav-profile-selector";

export const AppSidebar = ({
  sidebarWidth,
  navFolderOpen,
  navSessionsOpen,
}: {
  sidebarWidth?: string;
  navFolderOpen: boolean;
  navSessionsOpen: boolean;
}) => {
  return (
    <Sidebar width={sidebarWidth} dragClassName="border-r min-h-0 h-full">
      <AppSidebarHeader />
      <SidebarContent className="flex min-h-0 flex-col overflow-hidden pt-2">
        <NavProfileSelector />
        <NavActions />
        <div className="no-scrollbar mask-fade-on-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
          <NavFolders defaultIsOpen={navFolderOpen} />
          <NavChatSessions defaultIsOpen={navSessionsOpen} />
        </div>
      </SidebarContent>
      <NavFooter />
      <SidebarRail />
    </Sidebar>
  );
};
