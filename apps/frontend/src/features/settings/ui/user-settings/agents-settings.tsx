"use client";
import { FormSkeleton, ListSkeleton } from "@/components/loading-skeletons";
import { useUser } from "@/features/auth/components/user-context";
import { MainAgentSkills } from "@/features/skills/components/main-agent-skills";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Hint } from "@/components/ui/hint";
import { client } from "@/lib/api";
import { SubAgentDefinition } from "@/lib/client";
import {
  chatModelsListOptions,
  mainAgentGetOptions,
  subAgentDeleteMutation,
  subAgentsListOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  PencilIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AgentProfileForm, MainAgentForm } from "./agent-profile-form";

export const AgentsSettings = () => {
  const user = useUser();
  const [page, setPage] = useState(1);

  const [editingAgent, setEditingAgent] = useState<SubAgentDefinition | null>(
    null,
  );

  const main = useQuery({ ...mainAgentGetOptions({ client }), staleTime: 0 });

  const agents = useQuery({
    ...subAgentsListOptions({ client, query: { page, page_size: 10 } }),
    staleTime: 0,
  });

  const models = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
  });

  const subAgents = agents.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <h1 className="text-base font-bold">Agents</h1>
      <p className="text-muted-foreground">
        Adjust settings for the main chat agent and sub-agents.
      </p>
      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-6">
        <section
          aria-label="Main configuration"
          className="flex flex-col gap-3"
        >
          <header className="flex flex-wrap items-center gap-3 border-b pb-2">
            <h2 className="text-lg font-semibold">Main Agent</h2>
            {main.isPending && (
              <FormSkeleton label="Loading main configuration…" />
            )}
            {main.isError && (
              <QueryError
                error={main.error}
                message="Could not load main configuration."
                retry={() => void main.refetch()}
                isRetrying={main.isRefetching}
              />
            )}
            {main.data && (
              <>
                <MainAgentForm configuration={main.data} />
                <MainAgentSkills owner={user.id} />
              </>
            )}
          </header>
        </section>
        <section
          aria-label="Sub-agents"
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <header className="flex flex-wrap items-center gap-3 border-b pb-2">
            <h2 className="text-lg font-semibold">Sub-agents</h2>
            <AgentProfileForm
              profile={editingAgent}
              completeEditing={() => setEditingAgent(null)}
            />
          </header>

          <p className="text-muted-foreground text-sm">
            Create sub-agents by assigning a model, instructions, and tools.
            Then select them in a project. General chats do not have access to
            sub-agents.
          </p>
          {agents.isPending && (
            <ListSkeleton label="Loading sub-agents…" rows={3} detail />
          )}
          {agents.isError && (
            <QueryError
              error={agents.error}
              message="Could not load sub-agents."
              retry={() => void agents.refetch()}
              isRetrying={agents.isRefetching}
            />
          )}
          {agents.data?.total === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No sub-agents yet.</EmptyTitle>
                <EmptyDescription>
                  Create an agent to get started.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {agents.data && agents.data.total > 0 && subAgents.length === 0 && (
            <p>No sub-agents on this page. Use Previous to return.</p>
          )}
          {models.isError && (
            <QueryError
              error={models.error}
              message="Could not load model names."
              retry={() => void models.refetch()}
              isRetrying={models.isRefetching}
            />
          )}
          <div className="flex min-h-0 flex-wrap gap-4 overflow-y-auto">
            {subAgents.map((agent) => {
              const model = models.data?.find(
                (model) => model.id === agent.model_id,
              );
              return (
                <SubAgentCard
                  key={agent.id}
                  agent={agent}
                  modelLabel={
                    model
                      ? `${model.name} (${model.provider_name})`
                      : agent.model_id
                  }
                  edit={() => setEditingAgent(agent)}
                />
              );
            })}
          </div>
          <div className="flex min-h-0 flex-1 shrink-0 flex-col"></div>
          {agents.data && !!agents.data.total && (
            <nav
              aria-label="Sub-agent pages"
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={page === 1 || agents.isFetching}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page} /{" "}
                {Math.ceil(agents.data.total / agents.data.page_size)}
              </span>
              <Button
                variant="outline"
                disabled={
                  !agents.data ||
                  page * 10 >= agents.data.total ||
                  agents.isFetching
                }
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
};

function SubAgentCard({
  agent,
  edit,
  modelLabel,
}: {
  agent: SubAgentDefinition;
  edit: () => void;
  modelLabel: string;
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
  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${agent.name}`,
    description:
      "Delete this sub-agent definition and remove it from all projects? Active delegations will lose access. Chat history and files are retained.",
    confirmVariant: "destructive",
  });
  return (
    <Card className="flex h-80 w-60 max-w-full min-w-0 flex-col">
      {dialog}
      <CardHeader>
        <CardTitle className="[overflow-wrap:anywhere]">{agent.name}</CardTitle>
        <CardDescription className="flex items-center justify-between">
          <p className="text-muted-foreground truncate text-xs">{modelLabel}</p>
          <span role="status">
            <span className="sr-only">
              {agent.model_available
                ? "Fixed model available"
                : "Fixed model unavailable"}
            </span>
            {agent.model_available ? (
              <CheckCircle2Icon className="text-primary size-4 shrink-0" />
            ) : (
              <XCircleIcon className="text-destructive size-4 shrink-0" />
            )}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 overflow-auto">
        {agent.description || "No Description"}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        <Hint hint={`Edit ${agent.name}`} asChild>
          <Button
            variant="outline"
            aria-label={`Edit ${agent.name}`}
            disabled={mutation.isPending}
            onClick={edit}
          >
            <PencilIcon />
          </Button>
        </Hint>
        <Hint hint={`Delete ${agent.name}`} asChild>
          <Button
            variant="destructive"
            aria-label={`Delete ${agent.name}`}
            disabled={mutation.isPending}
            onClick={async () => {
              if (await confirm())
                mutation.mutate({ path: { agent_id: agent.id } });
            }}
          >
            <Trash2Icon />
          </Button>
        </Hint>
      </CardFooter>
    </Card>
  );
}
