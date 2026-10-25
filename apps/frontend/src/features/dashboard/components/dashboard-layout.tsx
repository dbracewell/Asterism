import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import UserProvider from "@/features/auth/components/user-context";
import { getCurrentUser } from "@/features/auth/server/session";
import { AppSidebar } from "@/features/dashboard/components/app-sidebar";
import { MobileSidebarTrigger } from "@/features/dashboard/components/mobile-sidebar-trigger";
import { ThemeCheck } from "@/features/dashboard/components/theme-check";
import { UpdateTimeZone } from "@/features/dashboard/components/update-timezone";
import {
  GENERAL_QUICK_CHATS_OPEN_COOKIE,
  PROJECTS_OPEN_COOKIE,
  SESSIONS_OPEN_COOKIE,
  SIDEBAR_WIDTH_COOKIE,
} from "@/features/dashboard/constants";
import { cookies } from "next/headers";
import React from "react";

export const DashboardLayout = async ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const user = await getCurrentUser();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";
  const sidebarWidth = cookieStore.get(SIDEBAR_WIDTH_COOKIE)?.value;
  const navGeneralQuickChatsOpen =
    cookieStore.get(GENERAL_QUICK_CHATS_OPEN_COOKIE)?.value === "true";
  const navProjectsOpen =
    cookieStore.get(PROJECTS_OPEN_COOKIE)?.value === "true";
  const navSessionsOpen =
    cookieStore.get(SESSIONS_OPEN_COOKIE)?.value === "true";

  return (
    <UserProvider user={user}>
      <ThemeCheck />
      <UpdateTimeZone />
      <SidebarProvider
        defaultOpen={defaultOpen}
        className="h-dvh min-h-0 flex-none"
      >
        <AppSidebar
          sidebarWidth={sidebarWidth}
          navSessionsOpen={navSessionsOpen}
          navProjectsOpen={navProjectsOpen}
          navGeneralQuickChatsOpen={navGeneralQuickChatsOpen}
        />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <MobileSidebarTrigger />
          <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  );
};
