"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

const agents = [
  { id: "main-default", name: "Default assistant", sub_agent: false },
  { id: "main-writer", name: "Writing assistant", sub_agent: false },
  { id: "worker", name: "Hidden worker", sub_agent: true },
];

export function NewChatAgentE2eHarness() {
  const mainAgents = agents.filter((agent) => !agent.sub_agent);
  const [agentId, setAgentId] = useState("main-default");
  const [createdWith, setCreatedWith] = useState<string | null>(null);

  return (
    <main className="p-8">
      <label htmlFor="new-chat-agent">Agent</label>
      <Select value={agentId} onValueChange={setAgentId}>
        <SelectTrigger id="new-chat-agent" aria-label="Main agent for new chat">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {mainAgents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>
              {agent.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button onClick={() => setCreatedWith(agentId)}>Start chat</button>
      {createdWith && <p role="status">Created with {createdWith}</p>}
    </main>
  );
}
