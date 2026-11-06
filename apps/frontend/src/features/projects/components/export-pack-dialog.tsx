"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { PackManifest } from "@/lib/client";
import {
  projectPackExportMutation,
  projectSubAgentGetManyOptions,
  promptTemplateGetManyOptions,
  rubricGetManyOptions,
  skillGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

const PAGE = { page: 1, page_size: 100 };
// Mirrors the pack format limits (ADR-0051).
const MAX_SUB_AGENTS = 16;
const MAX_SKILLS = 32;
const MAX_TEMPLATES = 32;
const MAX_RUBRICS = 16;

type Selection = Set<string>;

function downloadPack(pack: PackManifest) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${pack.pack.id}-${pack.pack.version}.team-pack.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function errorDetail(error: unknown) {
  return error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
    ? error.detail
    : "Could not build the pack. Reload and retry.";
}

/**
 * Exports a team pack (US-59.2). Nothing is preselected: the user names each
 * item to share. The server turns models into requirements and refuses
 * anything that looks like a credential.
 */
export function ExportPackDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
          <ExportPackForm
            projectId={projectId}
            projectName={projectName}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ExportPackForm({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const prefix = useId();
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState("");
  const [subAgents, setSubAgents] = useState<Selection>(() => new Set());
  const [skills, setSkills] = useState<Selection>(() => new Set());
  const [templates, setTemplates] = useState<Selection>(() => new Set());
  const [rubrics, setRubrics] = useState<Selection>(() => new Set());
  const [settings, setSettings] = useState(false);
  const agentList = useQuery({
    ...projectSubAgentGetManyOptions({
      client,
      path: { project_id: projectId },
      query: PAGE,
    }),
    retry: false,
  });
  const skillList = useQuery({
    ...skillGetManyOptions({ client, query: PAGE }),
    retry: false,
  });
  const templateList = useQuery({
    ...promptTemplateGetManyOptions({ client, query: PAGE }),
    retry: false,
  });
  const rubricList = useQuery({
    ...rubricGetManyOptions({ client, query: PAGE }),
    retry: false,
  });
  const exportPack = useMutation({
    ...projectPackExportMutation({ client }),
    // Exporting changes nothing, so no queries need refreshing.
    meta: { skipGlobalInvalidation: true },
    onSuccess: (pack) => {
      downloadPack(pack);
      onClose();
    },
  });
  const pending = exportPack.isPending;
  const empty =
    !settings &&
    subAgents.size + skills.size + templates.size + rubrics.size === 0;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Export team pack</DialogTitle>
        <DialogDescription>
          Choose what to share. Models are saved as requirements, and the pack
          holds no files, keys or provider details. Instructions are included as
          written, so read them before you share the file.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${prefix}-name`}>Pack name</FieldLabel>
            <Input
              id={`${prefix}-name`}
              value={name}
              maxLength={120}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${prefix}-description`}>
              Description
            </FieldLabel>
            <Textarea
              id={`${prefix}-description`}
              value={description}
              maxLength={2000}
              disabled={pending}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${prefix}-settings`}
            checked={settings}
            disabled={pending}
            onCheckedChange={(checked) => setSettings(checked === true)}
          />
          <label htmlFor={`${prefix}-settings`} className="text-sm">
            Project settings (name, description, instructions, color and goal)
          </label>
        </div>
        <PickList
          title="Sub-agents"
          query={agentList}
          items={agentList.data?.agents}
          total={agentList.data?.total}
          limit={MAX_SUB_AGENTS}
          selected={subAgents}
          onChange={setSubAgents}
          disabled={pending}
        />
        <PickList
          title="Skills"
          query={skillList}
          items={skillList.data?.items}
          total={skillList.data?.total}
          limit={MAX_SKILLS}
          selected={skills}
          onChange={setSkills}
          disabled={pending}
        />
        <PickList
          title="Templates"
          query={templateList}
          items={templateList.data?.items}
          total={templateList.data?.total}
          limit={MAX_TEMPLATES}
          selected={templates}
          onChange={setTemplates}
          disabled={pending}
        />
        <PickList
          title="Rubrics"
          query={rubricList}
          items={rubricList.data?.items}
          total={rubricList.data?.total}
          limit={MAX_RUBRICS}
          selected={rubrics}
          onChange={setRubrics}
          disabled={pending}
        />
      </div>
      {exportPack.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(exportPack.error)}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          disabled={pending || empty || !name.trim()}
          onClick={() =>
            exportPack.mutate({
              path: { project_id: projectId },
              body: {
                name: name.trim(),
                description,
                sub_agent_ids: [...subAgents],
                skill_ids: [...skills],
                template_ids: [...templates],
                rubric_ids: [...rubrics],
                include_project_settings: settings,
              },
            })
          }
        >
          {pending ? "Building…" : "Download pack"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PickList({
  title,
  query,
  items,
  total,
  limit,
  selected,
  onChange,
  disabled,
}: {
  title: string;
  query: {
    isPending: boolean;
    error: unknown;
    isFetching: boolean;
    refetch: () => unknown;
  };
  items: { id: string; name: string }[] | undefined;
  total: number | undefined;
  limit: number;
  selected: Selection;
  onChange: (next: Selection) => void;
  disabled: boolean;
}) {
  const prefix = useId();
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {query.isPending && (
        <ListSkeleton label={`Loading ${title.toLowerCase()}`} rows={2} />
      )}
      {!!query.error && (
        <QueryError
          error={query.error}
          message={`Could not load ${title.toLowerCase()}.`}
          retry={query.refetch}
          isRetrying={query.isFetching}
        />
      )}
      {items?.length === 0 && (
        <p className="text-muted-foreground text-sm">None available.</p>
      )}
      {!!items?.length && (
        <ul className="flex flex-col divide-y border-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <Checkbox
                id={`${prefix}-${item.id}`}
                checked={selected.has(item.id)}
                disabled={
                  disabled || (!selected.has(item.id) && selected.size >= limit)
                }
                onCheckedChange={(checked) => toggle(item.id, checked === true)}
              />
              <label
                htmlFor={`${prefix}-${item.id}`}
                className="min-w-0 flex-1 truncate text-sm"
              >
                {item.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {selected.size >= limit && (
        <p className="text-muted-foreground text-sm">
          A pack can hold {limit} {title.toLowerCase()}.
        </p>
      )}
      {!!items && !!total && total > items.length && (
        <p className="text-muted-foreground text-sm">
          Showing the first {items.length} of {total}.
        </p>
      )}
    </section>
  );
}
