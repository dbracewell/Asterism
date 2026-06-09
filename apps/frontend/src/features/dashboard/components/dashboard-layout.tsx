import { SidebarProvider } from "@/components/ui/sidebar";
import { AppContextProvider } from "@/features/dashboard/components/app-provider";
import { AppSidebar } from "@/features/dashboard/components/app-sidebar";
import { Header } from "@/features/dashboard/components/header";
import { auth } from "@/lib/auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export const DashboardLayout = async ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const headersList = await headers();
  const sessionData = await auth.api.getSession({ headers: headersList });
  if (!sessionData) {
    throw redirect("/");
  }
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";
  const sidebarWidth = cookieStore.get("asterism-sidebar-width")?.value;
  const navFolderOpen =
    cookieStore.get("asterism-folder-open")?.value === "true";
  const navSessionsOpen =
    cookieStore.get("asterism-sessions-open")?.value === "true";

  return (
    <AppContextProvider user={sessionData.user}>
      <SidebarProvider
        className="relative flex min-h-0 flex-1"
        defaultOpen={defaultOpen}
      >
        <AppSidebar
          sidebarWidth={sidebarWidth}
          navFolderOpen={navFolderOpen}
          navSessionsOpen={navSessionsOpen}
        />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <Header />
          <div className="no-scrollbar mask-fade-on-scroll flex min-h-0 flex-1 flex-col overflow-y-auto pt-8">
            <div className="flex flex-1 flex-col p-2">{children}</div>
          </div>
        </div>
      </SidebarProvider>
    </AppContextProvider>
  );
};
