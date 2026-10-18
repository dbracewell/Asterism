"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { UserProvider } from "@/features/auth/components/user-context";
import { ChatSession } from "@/features/chat/components/chat-session";
import { Button } from "@/components/ui/button";
import {
  chatFileGetScopeQueryKey,
  chatSessionGetOneQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";

export const chatId = "77777777-7777-4777-8777-777777777777";
export function ChatReachabilityHarness() {
  const [cache] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [sidebar, setSidebar] = useState(false);
  const params = useSearchParams();
  const pane = Number(params.get("pane")) || 1440;
  return (
    <QueryClientProvider client={cache}>
      <UserProvider
        user={{
          id: "test",
          name: "Layout tester",
          email: "layout@example.test",
          role: "user",
          timezone: "UTC",
          settings: {
            main_agent: {
              id: "main",
              name: "Main",
              description: "",
              system_prompt: "",
              tools: [],
            },
            show_thinking: true,
          },
        }}
      >
        <main className="flex h-dvh min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 flex-wrap gap-2 p-1">
            <Button size="sm" onClick={() => setSidebar(!sidebar)}>
              Toggle test panels
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void cache.refetchQueries({
                  queryKey: chatSessionGetOneQueryKey({
                    path: { chat_id: chatId },
                  }),
                })
              }
            >
              Refresh conversation
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void cache.refetchQueries({
                  queryKey: chatFileGetScopeQueryKey({
                    path: { chat_id: chatId },
                  }),
                })
              }
            >
              Refresh file scope
            </Button>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1">
            {sidebar && (
              <aside
                aria-label="Test sidebar"
                className="hidden w-40 shrink-0 border-r p-2 md:block"
              >
                Synthetic sidebar
              </aside>
            )}
            <div
              className="flex min-h-0 min-w-0 flex-col"
              style={{ width: `min(100%, ${pane}px)` }}
            >
              <ChatSession chatId={chatId} jwtToken="test-token" />
            </div>
            {sidebar && (
              <aside
                aria-label="Test side panel"
                className="hidden min-w-0 flex-1 border-l p-2 md:block"
              >
                Synthetic file panel
              </aside>
            )}
          </div>
        </main>
      </UserProvider>
    </QueryClientProvider>
  );
}
