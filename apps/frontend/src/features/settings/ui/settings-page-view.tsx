"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "@/features/auth/components/user-context";
import { AdminSettingsTab } from "@/features/settings/ui/admin-settings-tab";
import { UserSettingsTab } from "@/features/settings/ui/user-settings-tab";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export const SettingsPageView = () => {
  const user = useUser();
  const searchParams = useSearchParams();
  const tab = searchParams.get("t");
  const [setting, setSetting] = useState(
    searchParams.get("setting") ?? undefined,
  );
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Tabs
      onValueChange={(v) => {
        router.replace(`${pathname}?t=${v}`);
        setSetting(undefined);
      }}
      defaultValue={tab ?? "user"}
      className="flex min-h-0 flex-1 flex-col overflow-hidden! pt-12"
    >
      <TabsList>
        <TabsTrigger value="user">User Settings</TabsTrigger>
        {user.role === "admin" && (
          <TabsTrigger value="admin">Admin Settings</TabsTrigger>
        )}
      </TabsList>
      <UserSettingsTab defaultTab={setting} />
      {user.role === "admin" && <AdminSettingsTab defaultTab={setting} />}
    </Tabs>
  );
};
