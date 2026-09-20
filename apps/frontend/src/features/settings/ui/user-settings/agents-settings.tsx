import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { LoadingButton } from "@/components/loading-button";
import { Hint } from "@/components/ui/hint";
import { useUser } from "@/features/auth/components/user-context";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { AgentProfileForm } from "@/features/settings/ui/user-settings/agent-profile-form";
import { client } from "@/lib/api";
import { agentsDeleteAgentMutation } from "@/lib/client/@tanstack/react-query.gen";
import { AgentProfile } from "@/lib/client/types.gen";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { BotIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const AgentsSettings = () => {
  const user = useUser();
  const [editingAgent, setEditingAgent] = useState<AgentProfile | null>(null);
  const agents = useMemo(
    () => Object.values(user.settings.agents ?? []),
    [user],
  );
  const mainAgents = agents.filter((agent) => !agent.sub_agent);
  const subAgents = agents.filter((agent) => agent.sub_agent);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="items-centered flex justify-between border-b pb-2">
        <h1 className="text-base font-bold">Agents</h1>
        <AgentProfileForm
          profile={editingAgent}
          completeEditing={() => setEditingAgent(null)}
        />
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto">
        <AgentSection
          title="Main agents"
          description="Use these agents directly in chats. Your global default is used for new chats unless you choose another main agent."
          emptyMessage="Create a main agent to start chats."
          agents={mainAgents}
          editAgent={setEditingAgent}
          canDelete={() => mainAgents.length > 1}
        />
        <AgentSection
          title="Sub-agents"
          description="These delegated workers are available only when a main agent invokes them."
          emptyMessage="No sub-agents yet."
          agents={subAgents}
          editAgent={setEditingAgent}
          canDelete={() => true}
        />
      </div>
    </div>
  );
};

const AgentSection = ({
  title,
  description,
  emptyMessage,
  agents,
  editAgent,
  canDelete,
}: {
  title: string;
  description: string;
  emptyMessage: string;
  agents: AgentProfile[];
  editAgent: (profile: AgentProfile) => void;
  canDelete: (agent: AgentProfile) => boolean;
}) => (
  <section aria-label={title} className="flex flex-col gap-2">
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
    {agents.length === 0 ? (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        {emptyMessage}
      </p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            editAgent={editAgent}
            canDelete={canDelete(agent)}
          />
        ))}
      </div>
    )}
  </section>
);

const AgentCard = ({
  agent,
  editAgent,
  canDelete,
}: {
  agent: AgentProfile;
  editAgent: (profile: AgentProfile) => void;
  canDelete: boolean;
}) => {
  const user = useUser();
  const isDefaultAgent =
    !agent.sub_agent && user.settings.default_agent_id === agent.id;
  const router = useRouter();
  const deleteAgent = useMutation({
    ...agentsDeleteAgentMutation({
      client: client,
    }),
    onSuccess: (data) => {
      router.refresh();
      toast.success(`Successfully deleted agent ${data.name}`);
    },
    onError: () => toast.error("Failed to delete agent"),
  });

  const { updateSetting, isUpdatingUserSetting } = useUpdateUserSettings();
  const { confirm, Dialog } = useConfirmationDialog({
    title: `Delete ${agent.name}`,
    description: `Are you sure you want to delete ${agent.name}, the action cannot be undone`,
    confirmVariant: "destructive",
  });

  return (
    <div
      className={cn(
        "bg-card text-card-foreground flex h-40 w-60 flex-col gap-1 overflow-clip rounded-lg border text-sm",
        isDefaultAgent && "border-primary border",
        agent.model_id == null && "border-destructive bg-destructive/30",
      )}
    >
      <Dialog />
      <div className="bg-accent flex w-full items-center justify-between p-2">
        <h3 className="text-accent-foreground flex-1 font-medium">
          {agent.name}
        </h3>
        <div className="flex items-center gap-2">
          {!agent.sub_agent && isDefaultAgent ? (
            <Hint hint="Global default for new chats">
              <div
                aria-label="Global default for new chats"
                className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md px-2"
                role="img"
              >
                <BotIcon className="size-4 shrink-0" />
              </div>
            </Hint>
          ) : !agent.sub_agent ? (
            <Hint asChild hint="Set as global default for new chats">
              <LoadingButton
                variant="ghost"
                size="sm"
                aria-label="Set as global default for new chats"
                isLoading={deleteAgent.isPending || isUpdatingUserSetting}
                onClick={() => updateSetting("default_agent_id", agent.id)}
              >
                <BotIcon />
              </LoadingButton>
            </Hint>
          ) : null}
          <Hint hint="Edit" asChild>
            <LoadingButton
              variant="outline"
              size="sm"
              isLoading={deleteAgent.isPending || isUpdatingUserSetting}
              onClick={() => editAgent(agent)}
            >
              <PencilIcon />
            </LoadingButton>
          </Hint>
          <Hint hint="Delete" asChild>
            <LoadingButton
              variant="destructive"
              size="sm"
              disabled={!canDelete}
              isLoading={deleteAgent.isPending || isUpdatingUserSetting}
              onClick={async () => {
                if (await confirm()) {
                  deleteAgent.mutate({
                    path: {
                      agent_id: agent.id!,
                    },
                  });
                }
              }}
            >
              <Trash2Icon />
            </LoadingButton>
          </Hint>
        </div>
      </div>
      <p className="text-muted-foreground overflow-y-auto p-1 px-2">
        {agent.description}
      </p>
      {agent.model_id == null && (
        <p className="my-auto text-center text-white">No Model Defined!</p>
      )}
    </div>
  );
};
