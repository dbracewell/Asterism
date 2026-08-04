"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "@/features/auth/components/user-context";
import { AdminSettingsTab } from "@/features/settings/ui/admin-settings-tab";
import { UserSettingsTab } from "@/features/settings/ui/user-settings-tab";

export const SettingsPageView = () => {
  const user = useUser();
  return (
    <Tabs
      defaultValue={"user"}
      className="flex flex-1 flex-col overflow-hidden! pt-12"
    >
      <TabsList>
        <TabsTrigger value="user">User Settings</TabsTrigger>
        {user.role === "admin" && (
          <TabsTrigger value="admin">Admin Settings</TabsTrigger>
        )}
      </TabsList>
      <UserSettingsTab />
      {user.role === "admin" && <AdminSettingsTab />}
    </Tabs>
  );
};
