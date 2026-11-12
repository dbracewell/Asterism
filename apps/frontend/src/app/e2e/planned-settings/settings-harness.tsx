"use client";

import { Tabs } from "@/components/ui/tabs";
import UserProvider from "@/features/auth/components/user-context";
import { AdminSettingsTab } from "@/features/settings/ui/admin-settings-tab";
import { useSearchParams } from "next/navigation";

export function PlannedSettingsHarness() {
  const params = useSearchParams();
  return (
    <UserProvider
      user={{
        id: "admin-settings-tester",
        role: "admin",
        name: "Admin",
        email: "admin@example.test",
        timezone: "UTC",
        settings: {
          main_agent: { id: "main", name: "Main", description: "" },
        },
      }}
    >
      <main className="flex h-dvh min-h-0 min-w-0 flex-col">
        <Tabs value="admin" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AdminSettingsTab
            defaultTab={params.get("setting") ?? "group-settings"}
          />
        </Tabs>
      </main>
    </UserProvider>
  );
}
