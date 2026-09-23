"use client";

import { ProvidersTab } from "@/features/settings/ui/admin-settings/providers-tab";

export function ProviderE2EHarness() {
  return (
    <main className="mx-auto flex h-screen max-w-5xl flex-col p-6">
      <ProvidersTab />
    </main>
  );
}
