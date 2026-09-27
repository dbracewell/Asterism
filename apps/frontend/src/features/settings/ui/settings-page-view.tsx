"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "@/features/auth/components/user-context";
import { adminSettingsQueryOptions } from "@/features/settings/ui/admin-settings-query";
import { AdminSettingsTab } from "@/features/settings/ui/admin-settings-tab";
import { UserSettingsTab } from "@/features/settings/ui/user-settings-tab";
import { useReadWriteSearchParams } from "@/hooks/use-read-write-search-params";
import { useQueryClient } from "@tanstack/react-query";

export const SettingsPageView = () => {
  const user = useUser();
  const { getSearchParams, setSearchParams } = useReadWriteSearchParams();
  const [tab, setting] = getSearchParams(["t", "setting"]);
  const activeTab = tab === "admin" && user.role === "admin" ? "admin" : "user";
  const queryClient = useQueryClient();
  const prefetchAdminSettings = () => {
    void queryClient.prefetchQuery(adminSettingsQueryOptions());
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        setSearchParams({ t: value, setting: undefined });
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
