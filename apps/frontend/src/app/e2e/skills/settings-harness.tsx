"use client";

import UserProvider from "@/features/auth/components/user-context";
import type { User } from "@/features/auth/types";
import { SettingsPageView } from "@/features/settings/ui/settings-page-view";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";

const user: User = {
  id: "skills-owner",
  role: "user",
  name: "Skills tester",
  email: "skills@example.test",
  timezone: "UTC",
  settings: {
    main_agent: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Main",
      description: "",
      config_revision: 4,
    },
  },
};
function createCache() {
  const cache: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return cache;
}
export function SkillsSettingsHarness({ admin = false }: { admin?: boolean }) {
  const [cache] = useState(createCache);
  return (
    <QueryClientProvider client={cache}>
      <UserProvider user={admin ? { ...user, role: "admin" } : user}>
        <main className="flex h-dvh min-h-0 min-w-0 flex-col p-2">
          <SettingsPageView />
        </main>
      </UserProvider>
    </QueryClientProvider>
  );
}
