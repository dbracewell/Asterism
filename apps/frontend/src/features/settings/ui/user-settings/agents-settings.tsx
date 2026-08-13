import { useUser } from "@/features/auth/components/user-context";
import { AgentProfile } from "@/lib/client/types.gen";
import { useState } from "react";

export const AgentsSettings = () => {
  const user = useUser();
  const [editingAgent, setEditingAgent] = useState<string | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <h1 className="border-b pb-2 text-base font-bold">Agents</h1>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {Object.values(user.settings.agents ?? {}).map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
};

const AgentCard = ({ agent }: { agent: AgentProfile }) => {
  const user = useUser();

  return (
    <div className="bg-card text-card-foreground flex flex-col gap-1 rounded-lg border text-sm">
      <h3 className="bg-accent text-accent-foreground p-2 font-medium">
        {agent.name}
      </h3>
      <div className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-2">
        <span className="text-muted-foreground justify-self-end font-medium">
          Description
        </span>
        <p>{agent.description}</p>
        <span className="text-muted-foreground justify-self-end font-medium">
          System Prompt
        </span>
        <p>{agent.system_prompt ?? "Not Set"}</p>
        <span className="text-muted-foreground justify-self-end font-medium">
          Max Steps
        </span>
        <p>{agent.max_steps}</p>
        <span className="text-muted-foreground justify-self-end font-medium">
          Tools
        </span>
        <p>{agent.tools?.join(", ")}</p>
        <span className="text-muted-foreground justify-self-end font-medium">
          Model
        </span>
        <p>
          {user.settings.models?.find((m) => (m.id = agent.model_id))?.name ??
            "Unknown Model"}
        </p>
        <span className="text-muted-foreground justify-self-end font-medium">
          Parameters
        </span>
        <p>
          {Object.entries(agent.chat_parameters ?? {}).map(([k, v]) => (
            <span key={k}>
              {k} - {String(v)}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
};
