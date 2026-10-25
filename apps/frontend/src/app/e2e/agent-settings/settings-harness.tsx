"use client";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import UserProvider from "@/features/auth/components/user-context";
import { AgentsSettings } from "@/features/settings/ui/user-settings/agents-settings";

function createCache() {
  const cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        void cache.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return cache;
}
export function AgentSettingsHarness() {
  const [cache] = useState(createCache);
  return (
    <QueryClientProvider client={cache}>
      <main className="mx-auto flex w-full max-w-3xl flex-col p-4 md:p-8">
        <UserProvider
          user={{
            id: "agent-settings-tester",
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
    </QueryClientProvider>
  );
}
