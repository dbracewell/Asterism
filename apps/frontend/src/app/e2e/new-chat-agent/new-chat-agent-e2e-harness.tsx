"use client";

import { UserProvider } from "@/features/auth/components/user-context";
import { AgentsSettings } from "@/features/settings/ui/user-settings/agents-settings";

export function NewChatAgentE2eHarness() {
  return (
    <UserProvider
      user={{
        id: "test",
        name: "Test",
        email: "test@example.test",
        role: "user",
        timezone: "UTC",
        settings: {
          main_agent: {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Main agent",
            description: "",
            system_prompt: "Original instructions",
            max_steps: 5,
            tools: [],
            chat_parameters: {},
          },
          models: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "Available model",
              provider_id: "33333333-3333-4333-8333-333333333333",
              provider_name: "Test",
            },
          ],
          sub_agents: {
            worker: {
              id: "44444444-4444-4444-8444-444444444444",
              name: "Research worker",
              description: "Facts",
              model_id: "55555555-5555-4555-8555-555555555555",
              model_available: false,
              system_prompt: "Research",
              max_steps: 5,
              tools: [],
              chat_parameters: {},
            },
          },
        },
      }}
    >
      <main className="mx-auto flex h-screen max-w-3xl flex-col p-8">
        <AgentsSettings />
      </main>
    </UserProvider>
  );
}
