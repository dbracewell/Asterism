"use client";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type { ProjectSubAgentList, SubAgentDefinition } from "@/lib/client";
import {
  chatModelsListOptions,
  projectSubAgentCandidatesOptions,
  projectSubAgentGetManyOptions,
  projectSubAgentSelectManyMutation,
  projectSubAgentDeselectManyMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

export function ProjectSubAgents({
  projectId,
  disabled = false,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const [selectedPage, setSelectedPage] = useState(1);
  const [candidatePage, setCandidatePage] = useState(1);
  const [notice, setNotice] = useState("");
  const selected = useQuery({
    ...projectSubAgentGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page: selectedPage, page_size: 10 },
    }),
    staleTime: 0,
    retry: false,
  });
  const candidates = useQuery({
    ...projectSubAgentCandidatesOptions({
      client,
      path: { project_id: projectId },
      query: { page: candidatePage, page_size: 10 },
    }),
    staleTime: 0,
    retry: false,
  });
  const models = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const add = useMutation({
    ...projectSubAgentSelectManyMutation({ client }),
    onSuccess: () => setNotice("Sub-agent selected for this project."),
  });
  const remove = useMutation({
    ...projectSubAgentDeselectManyMutation({ client }),
    onSuccess: () =>
      setNotice(
        "Sub-agent deselected. Active delegations lose access; history and files remain.",
      ),
  });
  const mutationError = add.error ?? remove.error;
  const busy =
    disabled ||
    selected.isFetching ||
    candidates.isFetching ||
    add.isPending ||
    remove.isPending;
  const blocked =
    busy || !!selected.error || !!candidates.error || !!mutationError;
  async function reload() {
    const results = await Promise.all([
      selected.refetch(),
      candidates.refetch(),
    ]);
    if (results.every((result) => !result.isError)) {
      add.reset();
      remove.reset();
      setNotice(
        "Sub-agent selections reloaded. Deleted definitions are removed automatically.",
      );
    }
  }
  function label(agent: SubAgentDefinition) {
    const model = models.data?.find((model) => model.id === agent.model_id);
    return model ? `${model.name} (${model.provider_name})` : agent.model_id;
  }
  return (
    <section aria-label="Project sub-agents" className="flex flex-col gap-5">
      <h2 className="text-heading">Project sub-agents</h2>
      <p className="text-muted-foreground text-sm">
        Only selected sub-agents can receive delegated work from chats in this
        project. Each uses its fixed model. New projects start with no
        selections; General chats never delegate.
      </p>
      <Button variant="outline" asChild className="w-fit">
        <Link href="/settings?t=user&setting=agents">
          Manage sub-agent definitions
        </Link>
      </Button>
      {models.isError && (
        <QueryError
          error={models.error}
          message="Could not refresh model names. Fixed model IDs are shown where needed."
          retry={models.refetch}
          isRetrying={models.isFetching}
        />
      )}
      {mutationError && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p>
            {mutationError.detail ?? "Could not change project sub-agents."}{" "}
            Reload selections before retrying. No partial selection changes were
            saved.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void reload()}
          >
            Reload sub-agent selections
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <section aria-label="Selected sub-agents" className="flex flex-col gap-3">
        <h3 className="font-medium">Selected sub-agents</h3>
        {selected.isPending && (
          <ListSkeleton label="Loading selected sub-agents…" rows={2} />
        )}
        {selected.error && (
          <QueryError
            error={selected.error}
            message={
              selected.data
                ? "Could not refresh selections. Saved selections are shown; changes are disabled."
                : "Could not load selections."
            }
            retry={selected.refetch}
            isRetrying={selected.isFetching}
          />
        )}
        {selected.data?.total === 0 && (
          <EmptyState
            title="No selected sub-agents"
            description="Chats in this project use the main agent alone until you select a sub-agent below."
          />
        )}
        {selected.data?.agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            modelLabel={label(agent)}
            action="Deselect"
            disabled={blocked}
            onClick={() => {
              setNotice("");
              remove.mutate({
                path: { project_id: projectId },
                body: {
                  agent_ids: [agent.id],
                  expected_context_revision: selected.data!.context_revision,
                },
              });
            }}
          />
        ))}
        <AgentPages
          label="Selected sub-agents"
          page={selectedPage}
          data={selected.data}
          busy={busy}
          onPage={setSelectedPage}
        />
      </section>
      <section
        aria-label="Available sub-agents"
        className="flex flex-col gap-3"
      >
        <h3 className="font-medium">Available sub-agents</h3>
        {candidates.isPending && (
          <ListSkeleton label="Loading available sub-agents…" rows={3} />
        )}
        {candidates.error && (
          <QueryError
            error={candidates.error}
            message={
              candidates.data
                ? "Could not refresh available sub-agents. Changes are disabled."
                : "Could not load available sub-agents."
            }
            retry={candidates.refetch}
            isRetrying={candidates.isFetching}
          />
        )}
        {candidates.data?.total === 0 && (
          <EmptyState
            title="No more sub-agents to select"
            description="Create another sub-agent in agent settings, or deselect one above."
            action={
              <Button variant="outline" asChild>
                <Link href="/settings?t=user&setting=agents">
                  Create a sub-agent
                </Link>
              </Button>
            }
          />
        )}
        {candidates.data?.agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            modelLabel={label(agent)}
            action="Select"
            disabled={blocked || !agent.model_available}
            onClick={() => {
              setNotice("");
              add.mutate({
                path: { project_id: projectId },
                body: {
                  agent_ids: [agent.id],
                  expected_context_revision: candidates.data!.context_revision,
                },
              });
            }}
          />
        ))}
        <AgentPages
          label="Available sub-agents"
          page={candidatePage}
          data={candidates.data}
          busy={busy}
          onPage={setCandidatePage}
        />
      </section>
      <p className="text-muted-foreground text-sm">
        Deleted definitions disappear from selections. An unavailable fixed
        model keeps its binding and cannot run; edit the definition or restore
        the model to use it.
      </p>
    </section>
  );
}

function AgentRow({
  agent,
  modelLabel,
  action,
  disabled,
  onClick,
}: {
  agent: SubAgentDefinition;
  modelLabel: string;
  action: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-surface flex flex-wrap items-center justify-between gap-3 border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium break-words">{agent.name}</p>
        <p className="text-muted-foreground text-sm break-words">
          {agent.description}
        </p>
        <p className="text-sm break-words">Fixed model: {modelLabel}</p>
        {!agent.model_available && (
          <Badge variant="secondary">Model unavailable</Badge>
        )}
      </div>
      <Button variant="outline" disabled={disabled} onClick={onClick}>
        {action} {agent.name}
      </Button>
    </div>
  );
}
function AgentPages({
  label,
  page,
  data,
  busy,
  onPage,
}: {
  label: string;
  page: number;
  data?: ProjectSubAgentList;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex flex-wrap items-center gap-3"
    >
      <Button
        variant="outline"
        disabled={page === 1 || busy}
        onClick={() => onPage(page - 1)}
      >
        Previous {label.toLowerCase()}
      </Button>
      <span>
        Page {page}
        {data ? ` (${data.total} total)` : ""}
      </span>
      <Button
        variant="outline"
        disabled={!data || page * 10 >= data.total || busy}
        onClick={() => onPage(page + 1)}
      >
        Next {label.toLowerCase()}
      </Button>
      {data && data.total > 0 && data.agents.length === 0 && (
        <p>No sub-agents on this page. Return to a previous page.</p>
      )}
    </nav>
  );
}
