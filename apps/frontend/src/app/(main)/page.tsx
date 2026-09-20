"use client";
import { AnimatedBorder } from "@/components/animated-border";
import Constellation from "@/components/logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/features/auth/components/user-context";
import ChatInput from "@/features/chat/components/chat-input";
import { useChatSessionCrud } from "@/features/chat/hooks/use-chat-session-crud";
import { AgentProfile } from "@/lib/client";
import { BotIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function AppPage() {
  const user = useUser();
  const searchParams = useSearchParams();
  const { createChatSession } = useChatSessionCrud();
  const mainAgents = useMemo(
    () =>
      Object.values(user.settings.agents ?? {}).filter(
        (agent): agent is AgentProfile & { id: string } =>
          !agent.sub_agent && agent.id != null,
      ),
    [user.settings.agents],
  );
  const defaultAgentId = user.settings.default_agent_id ?? "";
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentId);
  const selectedAgent = mainAgents.find(
    (agent) => agent.id === selectedAgentId,
  );

  useEffect(() => {
    setSelectedAgentId((current) => {
      if (mainAgents.some((agent) => agent.id === current)) return current;
      return mainAgents.some((agent) => agent.id === defaultAgentId)
        ? defaultAgentId
        : "";
    });
  }, [defaultAgentId, mainAgents]);

  const agentSelectionMessage =
    mainAgents.length === 0
      ? "Create a main agent in Settings before starting a chat."
      : !selectedAgent
        ? "Select a main agent before starting a chat."
        : null;

  return (
    <div className="from-primary/5 via-primary/15 relative flex flex-1 flex-col items-center justify-center gap-6 bg-radial-[at_50%_50%] via-5% to-transparent to-60% p-2 pt-12">
      <Constellation
        className="repeat-[1] fill-mode-[forwards] absolute -z-10 animate-ping opacity-100 duration-500"
        fill="var(--color-secondary)"
        size={250}
      />
      <h1 className="z-1 text-4xl font-bold">
        Welcome <span className="text-primary">{user.name.split(" ")[0]}</span>
      </h1>
      <AnimatedBorder>
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-between gap-2 px-2">
            <label
              className="flex items-center gap-1 text-sm font-medium"
              htmlFor="new-chat-agent"
            >
              <BotIcon className="size-4" /> Agent
            </label>
            <Select
              disabled={mainAgents.length === 0}
              value={selectedAgentId}
              onValueChange={setSelectedAgentId}
            >
              <SelectTrigger
                id="new-chat-agent"
                aria-label="Main agent for new chat"
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
          {agentSelectionMessage && (
            <p className="text-destructive px-2 text-sm" role="alert">
              {agentSelectionMessage}
            </p>
          )}
          <ChatInput
            disabled={!selectedAgent}
            placeholder="Where will your curiosity lead you today?"
            onSubmit={({ prompt, files }) => {
              if (!selectedAgent) return;
              createChatSession({
                body: {
                  agent_id: selectedAgent.id,
                  folder_id: searchParams.get("folder_id"),
                  user_prompt: prompt,
                  files,
                },
              });
            }}
          />
        </div>
      </AnimatedBorder>
    </div>
  );
}
