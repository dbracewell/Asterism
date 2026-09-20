"use client";

import { AnimatedBorder } from "@/components/animated-border";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useUser } from "@/features/auth/components/user-context";
import ChatInput from "@/features/chat/components/chat-input";
import { useChatSessionCrud } from "@/features/chat/hooks/use-chat-session-crud";
import { client } from "@/lib/api";
import { AgentProfile } from "@/lib/client";
import {
  folderChatGetManyOptions,
  folderGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, MessageSquareIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 20;

export const FolderPage = ({ folderId }: { folderId: string }) => {
  const [page, setPage] = useState(1);
  const user = useUser();
  const mainAgents = useMemo(
    () =>
      Object.values(user.settings.agents ?? {}).filter(
        (agent): agent is AgentProfile & { id: string } =>
          !agent.sub_agent && agent.id != null,
      ),
    [user.settings.agents],
  );
  const [selectedAgentId, setSelectedAgentId] = useState(
    user.settings.default_agent_id ?? "",
  );
  const { createChatSession, isCreating } = useChatSessionCrud();
  const folder = useQuery({
    ...folderGetOneOptions({ client, path: { folder_id: folderId } }),
  });
  const chats = useQuery({
    ...folderChatGetManyOptions({
      client,
      path: { folder_id: folderId },
      query: { page, page_size: PAGE_SIZE },
    }),
  });
  useEffect(() => {
    setSelectedAgentId((current) =>
      mainAgents.some((agent) => agent.id === current)
        ? current
        : (user.settings.default_agent_id ?? ""),
    );
  }, [mainAgents, user.settings.default_agent_id]);

  if (folder.error || chats.error) throw folder.error ?? chats.error;
  if (!folder.data || !chats.data) return <Spinner />;

  const selectedAgent = mainAgents.find(
    (agent) => agent.id === selectedAgentId,
  );
  return (
    <main className="container mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 pt-16">
      <header>
        <p className="text-muted-foreground text-sm">Folder</p>
        <h1 className="text-2xl font-semibold">{folder.data.title}</h1>
      </header>
      <AnimatedBorder className="mx-auto">
        <section
          aria-label="Start a chat in this folder"
          className="flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2 px-2">
            <label
              className="flex items-center gap-1 text-sm font-medium"
              htmlFor="folder-chat-agent"
            >
              <BotIcon className="size-4" /> Agent
            </label>
            <Select
              disabled={mainAgents.length === 0}
              onValueChange={setSelectedAgentId}
              value={selectedAgentId}
            >
              <SelectTrigger
                aria-label="Main agent for folder chat"
                id="folder-chat-agent"
              >
                <SelectValue placeholder="Select a main agent" />
              </SelectTrigger>
              <SelectContent>
                {mainAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ChatInput
            disabled={!selectedAgent || isCreating}
            placeholder={`Start a chat in ${folder.data.title}`}
            onSubmit={({ prompt, files }) => {
              if (!selectedAgent) return;
              createChatSession({
                body: {
                  agent_id: selectedAgent.id,
                  folder_id: folderId,
                  user_prompt: prompt,
                  files,
                },
              });
            }}
          />
          {!selectedAgent && (
            <p className="text-destructive mt-2 text-sm" role="alert">
              Select a default main agent before starting a chat.
            </p>
          )}
        </section>
      </AnimatedBorder>
      <section
        aria-labelledby="folder-chats-heading"
        className="flex flex-col gap-2"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium" id="folder-chats-heading">
            Chats ({chats.data.total})
          </h2>
          {chats.isFetching && <Spinner />}
        </div>
        {chats.data.chats.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
            No chats in this folder yet.
          </p>
        ) : (
          chats.data.chats.map((chat) => (
            <Link
              className="hover:bg-accent rounded-lg border p-4 transition-colors"
              href={`/c/${chat.id}`}
              key={chat.id}
            >
              <div className="flex items-center gap-2 font-medium">
                <MessageSquareIcon className="size-4" />
                {chat.title ?? "Untitled chat"}
              </div>
              <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">
                {chat.preview || "No messages yet."}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                {chat.message_count ?? 0} messages
                {chat.agent_id && user.settings.agents?.[chat.agent_id]
                  ? ` · ${user.settings.agents[chat.agent_id].name}`
                  : ""}
                {" · Updated "}
                {new Date(chat.updated_at * 1000).toLocaleString()}
              </p>
            </Link>
          ))
        )}
      </section>
      {chats.data.total > PAGE_SIZE && (
        <div className="flex justify-end gap-2">
          <Button
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
            variant="outline"
          >
            Previous
          </Button>
          <Button
            disabled={page * PAGE_SIZE >= chats.data.total}
            onClick={() => setPage((value) => value + 1)}
            variant="outline"
          >
            Next
          </Button>
        </div>
      )}
    </main>
  );
};
