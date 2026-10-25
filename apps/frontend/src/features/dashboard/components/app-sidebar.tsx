import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { AppSidebarHeader } from "@/features/dashboard/components/app-sidebar-header";
import { NavActions } from "@/features/dashboard/components/nav-actions";
import { NavChatSessions } from "@/features/dashboard/components/nav-chat-sessions";
import { NavFooter } from "@/features/dashboard/components/nav-footer";
import { NavWorkspaces } from "@/features/projects/components/nav-workspaces";

export const AppSidebar = async ({
  sidebarWidth,
  navSessionsOpen,
  navProjectsOpen,
  navGeneralQuickChatsOpen,
}: {
  sidebarWidth?: string;
  navSessionsOpen: boolean;
  navProjectsOpen: boolean;
  navGeneralQuickChatsOpen: boolean;
}) => {
  return (
    <Sidebar width={sidebarWidth} className="overflow-hidden!">
      <AppSidebarHeader />
      <SidebarContent className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2">
        {/*<NavProfileSelector />*/}
        <NavActions />
        <div className="flex min-h-0 flex-1 flex-col">
          <NavWorkspaces
            defaultProjectsOpen={navProjectsOpen}
            defaultGeneralOpen={navGeneralQuickChatsOpen}
          />
          <NavChatSessions defaultIsOpen={navSessionsOpen} />
        </div>
      </SidebarContent>
      <NavFooter />
    </Sidebar>
  );
};
