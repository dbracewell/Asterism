import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { useUser } from "@/features/auth/components/user-context";
import { AgentProfileForm, MainAgentForm } from "./agent-profile-form";
import { client } from "@/lib/api";
import { subAgentDeleteMutation } from "@/lib/client/@tanstack/react-query.gen";
import { SubAgentDefinition } from "@/lib/client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export const AgentsSettings = () => {
  const user = useUser();
  const [editingAgent, setEditingAgent] = useState<SubAgentDefinition | null>(
    null,
  );
  const main = user.settings.main_agent;
  const subAgents = Object.values(user.settings.sub_agents ?? {});
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <h1 className="text-base font-bold">Agents</h1>
      <section aria-label="Main configuration" className="space-y-2">
        <h2 className="font-semibold">Main configuration</h2>
        <p className="text-muted-foreground text-sm">
          One configuration shared by your chats. Its model is chosen
          separately.
        </p>
        <MainAgentForm configuration={main} />
      </section>
      <section aria-label="Sub-agents" className="space-y-2">
        <h2 className="font-semibold">Sub-agents</h2>
        <AgentProfileForm
          profile={editingAgent}
          completeEditing={() => setEditingAgent(null)}
        />
        {subAgents.length === 0 && <p>No sub-agents yet.</p>}
        {subAgents.map((agent) => (
          <SubAgentCard
            key={agent.id}
            agent={agent}
            edit={() => setEditingAgent(agent)}
          />
        ))}
      </section>
    </div>
  );
};

function SubAgentCard({
  agent,
  edit,
}: {
  agent: SubAgentDefinition;
  edit: () => void;
}) {
  const router = useRouter();
  const mutation = useMutation({
    ...subAgentDeleteMutation({ client }),
    onSuccess: () => {
      router.refresh();
      toast.success("Sub-agent deleted");
    },
    onError: () => toast.error("Could not delete sub-agent"),
  });
  const { confirm, Dialog } = useConfirmationDialog({
    title: `Delete ${agent.name}`,
    description: "Delete this sub-agent definition?",
    confirmVariant: "destructive",
  });
  return (
    <div className="rounded-lg border p-3">
      <Dialog />
      <h3 className="font-medium">{agent.name}</h3>
      <p>{agent.description}</p>
      {!agent.model_available && (
        <p role="alert" className="text-destructive">
          Fixed model unavailable. Edit this definition to choose a replacement.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" disabled={mutation.isPending} onClick={edit}>
          Edit {agent.name}
        </Button>
        <Button
          variant="destructive"
          disabled={mutation.isPending}
          onClick={async () => {
            if (await confirm())
              mutation.mutate({ path: { agent_id: agent.id } });
          }}
        >
          Delete {agent.name}
        </Button>
      </div>
    </div>
  );
}
