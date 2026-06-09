"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminSettingsTab } from "@/features/settings/ui/admin-settings-tab";
import { UserSettingsTab } from "@/features/settings/ui/user-settings-tab";

export const SettingsPageView = ({ isAdmin }: { isAdmin: boolean }) => {
  return (
    <Tabs
      defaultValue={"user"}
      className="flex h-screen min-h-0 flex-1 flex-col pt-2"
    >
      <TabsList>
        <TabsTrigger value="user">User Settings</TabsTrigger>
        {isAdmin && <TabsTrigger value="admin">Admin Settings</TabsTrigger>}
      </TabsList>
      <UserSettingsTab />
      {isAdmin && <AdminSettingsTab />}
    </Tabs>
  );
};
