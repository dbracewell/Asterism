"use client";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { ChatSession } from "@/features/chat/components/chat-session";
import { UserProvider } from "@/features/auth/components/user-context";
import AppPage from "@/app/(main)/page";
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
export function ChatModelSessionHarness({
  draft,
  timezone,
  showThinking = false,
}: {
  draft: boolean;
  timezone: string;
  showThinking?: boolean;
}) {
  const [cache] = useState(createCache);
  return (
    <QueryClientProvider client={cache}>
      <UserProvider
        user={{
          id: "test",
          name: "Test",
          email: "test@example.test",
          role: "user",
          timezone,
          settings: {
            main_agent: {
              id: "66666666-6666-4666-8666-666666666666",
              name: "Main",
              description: "",
              system_prompt: "Be precise",
              tools: [],
            },
            default_model_id: "11111111-1111-4111-8111-111111111111",
            show_thinking: showThinking,
          },
        }}
      >
        <div className="relative flex h-screen flex-col">
          {draft ? (
            <AppPage />
          ) : (
            <ChatSession
              chatId="77777777-7777-4777-8777-777777777777"
              jwtToken="test-token"
            />
          )}
        </div>
      </UserProvider>
    </QueryClientProvider>
  );
}
