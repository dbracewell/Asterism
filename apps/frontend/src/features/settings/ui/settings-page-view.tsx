"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/components/user-context";
import { adminSettingsQueryOptions } from "@/features/settings/ui/admin-settings-query";
import { AdminSettingsTab } from "@/features/settings/ui/admin-settings-tab";
import { UserSettingsTab } from "@/features/settings/ui/user-settings-tab";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const SettingsPageView = () => {
  const user = useUser();
  const searchParams = useSearchParams();
  const tab = searchParams.get("t");
  const setting = searchParams.get("setting") ?? undefined;
  const activeTab = tab === "admin" && user.role === "admin" ? "admin" : "user";
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const prefetchAdminSettings = () => {
    void queryClient.prefetchQuery(adminSettingsQueryOptions());
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        router.replace(`${pathname}?t=${value}`);
      }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden! pt-12"
    >
      <TabsList>
        <TabsTrigger value="user">User Settings</TabsTrigger>
        {user.role === "admin" && (
          <TabsTrigger
            value="admin"
            onFocus={prefetchAdminSettings}
            onPointerEnter={prefetchAdminSettings}
          >
            Admin Settings
          </TabsTrigger>
        )}
      </TabsList>
      {activeTab === "user" && <UserSettingsTab defaultTab={setting} />}
      {activeTab === "admin" && user.role === "admin" && (
        <AdminSettingsTab defaultTab={setting} />
      )}
    </Tabs>
  );
};
