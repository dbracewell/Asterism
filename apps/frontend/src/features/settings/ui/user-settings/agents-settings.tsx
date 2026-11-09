"use client";
import { HelpTopic } from "@/features/help/components/help-topic";
import { EmptyState } from "@/components/empty-state";
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
import { Hint } from "@/components/ui/hint";
import { client } from "@/lib/api";
import { modelLabel } from "@/components/settings/model-identity";
import { SubAgentDefinition } from "@/lib/client";
import { CourseManagedBadge } from "@/components/course-managed-badge";
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
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { AgentProfileForm, MainAgentForm } from "./agent-profile-form";
import { GeneralSubAgents } from "./general-sub-agents";

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
    <SettingsPane
      title="Agents"
      description="Adjust settings for the main chat agent and sub-agents."
    >
      <SettingsSection
        title="Main agent"
        description="Instructions, skills and capabilities shared by your chats. Choose the model separately for each chat."
        actions={
          main.data && (
            <>
              <MainAgentSkills owner={user.id} />
              <MainAgentForm configuration={main.data} />
            </>
          )
        }
      >
        {main.isPending && <FormSkeleton label="Loading main configuration…" />}
        {main.isError && (
          <QueryError
            error={main.error}
            message="Could not load main configuration."
            retry={() => void main.refetch()}
            isRetrying={main.isRefetching}
          />
        )}
        {main.data && <GeneralSubAgents />}
      </SettingsSection>
      <SettingsSection
        title="Sub-agents"
        description="Create sub-agents by assigning a model, instructions, and tools. Then choose them for General chats above, or select them in a project."
        actions={
          <AgentProfileForm
            profile={editingAgent}
            completeEditing={() => setEditingAgent(null)}
          />
        }
      >
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
          <EmptyState
            title="No sub-agents yet"
            description="Use Create sub-agent to give a model its own instructions and tools for the main agent to hand work to."
            help={<HelpTopic id="concept.sub-agent" />}
          />
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
        {subAgents.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-4">
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
                      ? `${modelLabel(model)} (${model.provider_name})`
                      : agent.model_id
                  }
                  edit={() => setEditingAgent(agent)}
                />
              );
            })}
          </div>
        )}
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
      </SettingsSection>
    </SettingsPane>
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
      "Delete this sub-agent definition and remove it from all projects and General chats? Active delegations will lose access. Chat history and files are retained.",
    confirmVariant: "destructive",
  });
  return (
    <Card className="flex h-80 w-60 max-w-full min-w-0 flex-col">
      {dialog}
      <CardHeader className="min-w-0">
        <CardTitle className="[overflow-wrap:anywhere]">{agent.name}</CardTitle>
        <CardDescription className="flex min-w-0 items-center justify-between gap-2">
          {/* Long model names end in an ellipsis; the full name stays in the text and title. */}
          <p
            className="text-muted-foreground min-w-0 truncate text-xs"
            title={modelLabel}
          >
            {modelLabel}
          </p>
          <span role="status" className="shrink-0">
            <span className="sr-only">
              {agent.model_available
                ? "Fixed model available"
                : `Fixed model unavailable${agent.model_unavailable_reason ? `: ${agent.model_unavailable_reason}` : ""}`}
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
        {agent.managed_by_class && (
          <CourseManagedBadge managedBy={agent.managed_by_class} />
        )}
        {agent.description || "No Description"}
      </CardContent>
      {agent.managed_by_class ? (
        <CardFooter>
          <p className="text-muted-foreground text-xs">
            Part of a course, so only course updates can change it.
          </p>
        </CardFooter>
      ) : (
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
      )}
    </Card>
  );
}
