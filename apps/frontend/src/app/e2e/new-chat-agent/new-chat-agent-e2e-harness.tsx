"use client";

import UserProvider from "@/features/auth/components/user-context";
import { AgentsSettings } from "@/features/settings/ui/user-settings/agents-settings";

export function NewChatAgentE2eHarness() {
  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col p-8">
      <UserProvider
        user={{
          id: "new-chat-agent-tester",
          role: "user",
          name: "Tester",
          email: "tester@example.test",
          timezone: "UTC",
          settings: {
            main_agent: { id: "main", name: "Main", description: "" },
          },
        }}
      >
        <AgentsSettings />
      </UserProvider>
    </main>
  );
}
