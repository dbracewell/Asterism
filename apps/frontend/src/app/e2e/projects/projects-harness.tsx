"use client";
import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
  useQuery,
} from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";
import { ProjectList } from "@/features/projects/components/project-list";
import { ProjectWorkspace } from "@/features/projects/components/project-workspace";
import { NavWorkspaces } from "@/features/projects/components/nav-workspaces";
import { WorkspaceChats } from "@/features/projects/components/workspace-chats";
import { ChatWorkspace } from "@/features/projects/components/chat-workspace";
import { client } from "@/lib/api";
import { chatSessionGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useState } from "react";
export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "33333333-3333-4333-8333-333333333333";
function ChatView() {
  const chat = useQuery(
    chatSessionGetOneOptions({ client, path: { chat_id: CHAT_ID } }),
  );
  return chat.data ? (
    <main className="mx-auto w-full max-w-3xl p-8">
      <ChatWorkspace info={chat.data.info} disabled={false} />
      <p>Existing conversation history</p>
    </main>
  ) : null;
}
function createTestCache() {
  const cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        cache.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return cache;
}
export function ProjectsHarness({
  view,
  projectId = PROJECT_ID,
}: {
  view: string;
  projectId?: string;
}) {
  const [cache] = useState(createTestCache);
  return (
    <QueryClientProvider client={cache}>
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>
            <NavWorkspaces />
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          {view === "settings" ? (
            <ProjectWorkspace projectId={projectId} settings />
          ) : view === "overview" ? (
            <ProjectWorkspace projectId={PROJECT_ID} />
          ) : view === "general" ? (
            <WorkspaceChats projectId={null} />
          ) : view === "chat" ? (
            <ChatView />
          ) : (
            <ProjectList />
          )}
        </SidebarInset>
      </SidebarProvider>
    </QueryClientProvider>
  );
}
