"use client";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
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
        <AgentsSettings />
      </main>
    </QueryClientProvider>
  );
}
