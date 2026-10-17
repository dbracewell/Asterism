"use client";

import { AgentsSettings } from "@/features/settings/ui/user-settings/agents-settings";

export function NewChatAgentE2eHarness() {
  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col p-8">
      <AgentsSettings />
    </main>
  );
}
