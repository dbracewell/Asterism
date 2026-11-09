"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { modelLabel } from "@/components/settings/model-identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { HelpTopic } from "@/features/help/components/help-topic";
import { client } from "@/lib/api";
import type { ChatModelChoice, SubAgentDefinition } from "@/lib/client";
import {
  chatModelsListOptions,
  mainAgentGeneralSubAgentsGetOptions,
  mainAgentGeneralSubAgentsUpdateMutation,
  subAgentsListOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

const PAGE_SIZE = 10;

const fixedModelLabel = (
  agent: SubAgentDefinition,
  models?: ChatModelChoice[],
) => {
  const model = models?.find((model) => model.id === agent.model_id);
  return model
    ? `${modelLabel(model)} (${model.provider_name})`
    : agent.model_id;
};

/** The General chat set (ADR-0059): which sub-agents the main agent may use outside projects. */
export function GeneralSubAgents() {
  const set = useQuery({
    ...mainAgentGeneralSubAgentsGetOptions({ client }),
    staleTime: 0,
  });
  const models = useQuery({ ...chatModelsListOptions({ client }) });
  return (
    <section
      aria-label="General chat sub-agents"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 font-medium">
          General chat sub-agents
          <HelpTopic id="concept.sub-agent" />
        </h3>
        {set.data && <GeneralSubAgentsPicker />}
      </div>
      <p className="text-muted-foreground text-sm">
        Sub-agents the main agent may hand work to in chats outside projects.
        Project chats use the sub-agents selected in their project instead.
      </p>
      {set.isPending && (
        <ListSkeleton label="Loading General chat sub-agents…" rows={1} />
      )}
      {set.error && (
        <QueryError
          error={set.error}
          message="Could not load General chat sub-agents."
          retry={set.refetch}
          isRetrying={set.isFetching}
        />
      )}
      {set.data && !set.data.delegation_allowed && (
        <p role="status" className="text-sm">
          An administrator has turned sub-agents off, so General chats
          can&apos;t delegate right now. Your choices are kept.
        </p>
      )}
      {set.data?.agents.length === 0 && (
        <p className="text-sm">
          None chosen. In General chats the main agent works alone.
        </p>
      )}
      {!!set.data?.agents.length && (
        <ul className="flex flex-col gap-2">
          {set.data.agents.map((agent) => (
            <li
              key={agent.id}
              className="rounded-surface flex flex-wrap items-center gap-2 border p-3"
            >
              <span className="min-w-0 font-medium wrap-anywhere">
                {agent.name}
              </span>
              <span className="text-muted-foreground min-w-0 text-sm wrap-anywhere">
                {fixedModelLabel(agent, models.data)}
              </span>
              <AvailabilityBadge agent={agent} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AvailabilityBadge({ agent }: { agent: SubAgentDefinition }) {
  return agent.model_available ? (
    <Badge variant="outline">Available</Badge>
  ) : (
    <>
      <Badge variant="secondary">Model unavailable</Badge>
      {agent.model_unavailable_reason && (
        <span className="text-muted-foreground text-sm">
          {agent.model_unavailable_reason}
        </span>
      )}
    </>
  );
}

function GeneralSubAgentsPicker() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Choose General chat sub-agents
        </Button>
      </DialogTrigger>
      {open && <PickerDialog close={() => setOpen(false)} />}
    </Dialog>
  );
}

type Draft = { revision: number; agent_ids: string[] };

function PickerDialog({ close }: { close: () => void }) {
  const [page, setPage] = useState(1);
  const set = useQuery({
    ...mainAgentGeneralSubAgentsGetOptions({ client }),
    staleTime: 0,
  });
  const agents = useQuery({
    ...subAgentsListOptions({ client, query: { page, page_size: PAGE_SIZE } }),
    staleTime: 0,
  });
  const models = useQuery({ ...chatModelsListOptions({ client }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reloading, setReloading] = useState(false);
  const mutation = useMutation(
    mainAgentGeneralSubAgentsUpdateMutation({ client }),
  );
  const saved: Draft | undefined = set.data && {
    revision: set.data.revision,
    agent_ids: set.data.agents.map((agent) => agent.id),
  };
  const selection = draft ?? saved;
  const changed = !!draft && !!set.data && set.data.revision > draft.revision;
  const busy = mutation.isPending || reloading;
  const discard = useConfirmationDialog({
    title: "Discard sub-agent changes?",
    description: "Your pending General chat sub-agent choices will be lost.",
    confirmText: "Discard changes",
    confirmVariant: "destructive",
  });
  const requestClose = async () => {
    if (!busy && (!draft || (await discard.confirm()))) close();
  };
  const lastPage = agents.data
    ? Math.max(1, Math.ceil(agents.data.total / PAGE_SIZE))
    : page;
  if (page > lastPage) setPage(lastPage);
  return (
    <DialogContent
      showCloseButton={false}
      className="sm:max-w-2xl"
      onEscapeKeyDown={(event) => {
        event.preventDefault();
        void requestClose();
      }}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>General chat sub-agents</DialogTitle>
        <DialogDescription>
          Choose which of your sub-agents the main agent may hand work to in
          chats outside projects. Each keeps its fixed model, and only sees the
          files attached to that chat.
        </DialogDescription>
      </DialogHeader>
      {discard.dialog}
      {set.data && !set.data.delegation_allowed && (
        <p role="status" className="text-sm">
          An administrator has turned sub-agents off. You can still choose them;
          they&apos;ll be used once sub-agents are turned back on.
        </p>
      )}
      {set.isPending && (
        <ListSkeleton label="Loading General chat sub-agents…" rows={2} />
      )}
      {set.error && (
        <QueryError
          error={set.error}
          message={
            set.data
              ? "Could not refresh General chat sub-agents. Your choices are kept."
              : "Could not load General chat sub-agents."
          }
          retry={set.refetch}
          isRetrying={set.isFetching}
        />
      )}
      {changed && (
        <p role="status">
          General chat sub-agents changed elsewhere. Reload them before saving;
          your pending choices are kept until then.
        </p>
      )}
      {agents.isPending && (
        <ListSkeleton label="Loading sub-agents…" rows={3} />
      )}
      {agents.error && (
        <QueryError
          error={agents.error}
          message="Could not load your sub-agents. Your choices are kept."
          retry={agents.refetch}
          isRetrying={agents.isFetching}
        />
      )}
      {agents.data?.total === 0 && (
        <p>Create a sub-agent in User Settings → Agents before choosing one.</p>
      )}
      {selection && (
        <>
          <p role="status">
            {selection.agent_ids.length} chosen. Choices on other pages are
            kept.
          </p>
          <FieldGroup>
            {agents.data?.items.map((agent) => {
              const checked = selection.agent_ids.includes(agent.id);
              return (
                <Field key={agent.id} orientation="horizontal">
                  <Checkbox
                    id={`general-${agent.id}`}
                    checked={checked}
                    disabled={busy || (!checked && !agent.model_available)}
                    onCheckedChange={(value) =>
                      setDraft({
                        revision: selection.revision,
                        agent_ids:
                          value === true
                            ? [...selection.agent_ids, agent.id]
                            : selection.agent_ids.filter(
                                (id) => id !== agent.id,
                              ),
                      })
                    }
                  />
                  <FieldLabel
                    htmlFor={`general-${agent.id}`}
                    className="min-w-0 flex-1 flex-col items-start gap-1 wrap-anywhere"
                  >
                    <span>{agent.name}</span>
                    {agent.description && (
                      <span className="text-muted-foreground">
                        {agent.description}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      Fixed model: {fixedModelLabel(agent, models.data)}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <AvailabilityBadge agent={agent} />
                    </span>
                  </FieldLabel>
                </Field>
              );
            })}
          </FieldGroup>
        </>
      )}
      {agents.data && agents.data.total > PAGE_SIZE && (
        <nav
          aria-label="General chat sub-agent pages"
          className="flex flex-wrap items-center justify-end gap-2"
        >
          <Button
            variant="outline"
            disabled={page === 1 || agents.isFetching}
            onClick={() => setPage(page - 1)}
          >
            Previous sub-agents
          </Button>
          <span>
            Page {page} of {lastPage}
          </span>
          <Button
            variant="outline"
            disabled={page === lastPage || agents.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Next sub-agents
          </Button>
        </nav>
      )}
      {mutation.error && (
        <p role="alert">
          {mutation.error.detail ?? "Could not save General chat sub-agents."}{" "}
          Nothing was changed. Reload current choices before retrying.
        </p>
      )}
      <footer className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={busy || set.isFetching}
          onClick={async () => {
            if (draft && !(await discard.confirm())) return;
            setReloading(true);
            try {
              const result = await set.refetch();
              if (!result.error) {
                setDraft(null);
                mutation.reset();
              }
            } finally {
              setReloading(false);
            }
          }}
        >
          Reload current choices
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void requestClose()}
        >
          Cancel
        </Button>
        <Button
          disabled={!draft || busy || changed}
          onClick={async () => {
            if (!draft || changed) return;
            try {
              await mutation.mutateAsync({
                body: {
                  agent_ids: draft.agent_ids,
                  expected_revision: draft.revision,
                },
              });
              toast.success("General chat sub-agents saved");
              close();
            } catch {
              /* Keep pending choices and their original revision. */
            }
          }}
        >
          {mutation.isPending ? "Saving…" : "Save choices"}
        </Button>
      </footer>
    </DialogContent>
  );
}
