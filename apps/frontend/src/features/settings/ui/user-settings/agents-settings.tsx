import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { LoadingButton } from "@/components/loading-button";
import { Hint } from "@/components/ui/hint";
import { useUser } from "@/features/auth/components/user-context";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { AgentProfileForm } from "@/features/settings/ui/user-settings/AgentProfileForm";
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="items-centered flex justify-between border-b pb-2">
        <h1 className="text-base font-bold">Agents</h1>
        <AgentProfileForm
          profile={editingAgent}
          completeEditing={() => setEditingAgent(null)}
        />
      </div>

      <div className="flew-wrap flex flex-1 content-start items-start justify-start gap-2 overflow-y-auto">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            editAgent={setEditingAgent}
            canDelete={agents.length > 1}
          />
        ))}
      </div>
    </div>
  );
};

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
  const isDefaultAgent = user.settings.default_agent_id === agent.id;
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
      )}
    >
      <Dialog />
      <div className="bg-accent flex w-full items-center justify-between p-2">
        <h3 className="text-accent-foreground flex-1 font-medium">
          {agent.name}
        </h3>
        <div className="flex items-center gap-2">
          {isDefaultAgent ? (
            <Hint hint="Default agent">
              <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md px-2">
                <BotIcon className="size-4 shrink-0" />
              </div>
            </Hint>
          ) : (
            <Hint asChild hint="Set as default agent">
              <LoadingButton
                variant="ghost"
                size="sm"
                isLoading={deleteAgent.isPending || isUpdatingUserSetting}
                onClick={() => updateSetting("default_agent_id", agent.id)}
              >
                <BotIcon />
              </LoadingButton>
            </Hint>
          )}
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
                      agent_id: agent.id,
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
    </div>
  );
};
