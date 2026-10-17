"use client";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { AgentProfileForm, MainAgentForm } from "./agent-profile-form";
import { client } from "@/lib/api";
import {
  mainAgentGetOptions,
  subAgentsListOptions,
  chatModelsListOptions,
  subAgentDeleteMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { SubAgentDefinition } from "@/lib/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export const AgentsSettings = () => {
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
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <h1 className="text-base font-bold">Agents</h1>
      <section aria-label="Main configuration" className="flex flex-col gap-3">
        <h2 className="font-semibold">Main configuration</h2>
        <p className="text-muted-foreground text-sm">
          One configuration shared by your chats. Its model is chosen
          separately.
        </p>
        {main.isPending && <p role="status">Loading main configuration…</p>}
        {main.isError && (
          <QueryFailure
            cached={!!main.data}
            label="main configuration"
            retry={() => void main.refetch()}
          />
        )}
        {main.data && <MainAgentForm configuration={main.data} />}
      </section>
      <section aria-label="Sub-agents" className="flex flex-col gap-3">
        <h2 className="font-semibold">Sub-agents</h2>
        <AgentProfileForm
          profile={editingAgent}
          completeEditing={() => setEditingAgent(null)}
        />
        <p className="text-muted-foreground text-sm">
          Create workers with a fixed model, then select them in a project.
          General chats do not delegate.
        </p>
        {agents.isPending && <p role="status">Loading sub-agents…</p>}
        {agents.isError && (
          <QueryFailure
            cached={!!agents.data}
            label="sub-agents"
            retry={() => void agents.refetch()}
          />
        )}
        {agents.data?.total === 0 && (
          <p>No sub-agents yet. Create a worker to get started.</p>
        )}
        {agents.data && agents.data.total > 0 && subAgents.length === 0 && (
          <p>No sub-agents on this page. Use Previous to return.</p>
        )}
        {models.isError && (
          <QueryFailure
            cached={!!models.data}
            label="model names"
            retry={() => void models.refetch()}
          />
        )}
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
            Page {page}
            {agents.data ? ` · ${agents.data.total} sub-agents` : ""}
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
      </section>
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
  const { confirm, Dialog } = useConfirmationDialog({
    title: `Delete ${agent.name}`,
    description:
      "Delete this sub-agent definition and remove it from all projects? Active delegations will lose access. Chat history and files are retained.",
    confirmVariant: "destructive",
  });
  return (
    <Card>
      <Dialog />
      <CardHeader>
        <CardTitle className="break-words">{agent.name}</CardTitle>
        <CardDescription className="break-words">
          {agent.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm break-words">Fixed model: {modelLabel}</p>
        <Badge variant="secondary">
          {agent.model_available ? "Available" : "Model unavailable"}
        </Badge>
        {!agent.model_available && (
          <Empty role="alert" className="flex-none p-3">
            <EmptyDescription>
              Fixed model unavailable. Edit this definition to choose a
              replacement.
            </EmptyDescription>
          </Empty>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
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
      </CardFooter>
    </Card>
  );
}

function QueryFailure({
  cached,
  label,
  retry,
}: {
  cached: boolean;
  label: string;
  retry: () => void;
}) {
  return (
    <Empty role="alert" className="flex-none p-3">
      <EmptyDescription>
        Could not {cached ? "refresh" : "load"} {label}.
        {cached ? " Showing saved data." : ""}
        <Button type="button" variant="outline" onClick={retry}>
          Retry {label}
        </Button>
      </EmptyDescription>
    </Empty>
  );
}
