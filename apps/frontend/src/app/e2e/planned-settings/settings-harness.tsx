"use client";

import { Tabs } from "@/components/ui/tabs";
import { AdminSettingsTab } from "@/features/settings/ui/admin-settings-tab";
import { useSearchParams } from "next/navigation";

export function PlannedSettingsHarness() {
  const params = useSearchParams();
  return (
    <main className="flex h-dvh min-h-0 min-w-0 flex-col">
      <Tabs value="admin" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AdminSettingsTab
          defaultTab={params.get("setting") ?? "group-settings"}
        />
      </Tabs>
    </main>
  );
}
