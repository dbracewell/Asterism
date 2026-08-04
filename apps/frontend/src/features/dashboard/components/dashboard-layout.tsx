import { SidebarProvider } from "@/components/ui/sidebar";
import UserProvider from "@/features/auth/components/user-context";
import { getCurrentUser } from "@/features/auth/server/actions";
import { AppSidebar } from "@/features/dashboard/components/app-sidebar";
import { Header } from "@/features/dashboard/components/header";
import { ThemeCheck } from "@/features/dashboard/components/theme-check";
import { UpdateTimeZone } from "@/features/dashboard/components/update-timezone";
import {
  FOLDER_OPEN_COOKIE,
  SESSIONS_OPEN_COOKIE,
  SIDBAR_WIDTH_COOKIE,
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
  const sidebarWidth = cookieStore.get(SIDBAR_WIDTH_COOKIE)?.value;
  const navFolderOpen = cookieStore.get(FOLDER_OPEN_COOKIE)?.value === "true";
  const navSessionsOpen =
    cookieStore.get(SESSIONS_OPEN_COOKIE)?.value === "true";

  return (
    <UserProvider user={user}>
      <ThemeCheck />
      <UpdateTimeZone />
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar
          sidebarWidth={sidebarWidth}
          navFolderOpen={navFolderOpen}
          navSessionsOpen={navSessionsOpen}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Header />
          <div className="flex min-h-0 flex-1 flex-col p-2">{children}</div>
        </div>
      </SidebarProvider>
    </UserProvider>
  );
};
