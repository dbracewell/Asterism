"use client";

import { HelpTopic } from "@/features/help/components/help-topic";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { useUser } from "@/features/auth/components/user-context";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import type { SkillSummary } from "@/lib/client";
import { mainAgentSkillsUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  SKILL_PAGE_SIZES,
  useSkillListParams,
} from "../hooks/use-skill-list-params";
import {
  skillAssignmentsOptions,
  skillMutationInvalidates,
  skillsListOptions,
} from "../queries";
import { SkillAvailability, SkillFailure } from "./skill-status";
import { SkillEditorDialog } from "./skill-editor-dialog";

const MAX_ASSIGNED = 100;

export function SkillsSettings() {
  const user = useUser();
  return <OwnedSkillsSettings key={user.id} owner={user.id} />;
}

function OwnedSkillsSettings({ owner }: { owner: string }) {
  const [{ query, page, pageSize }, update] = useSkillListParams();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const skills = useQuery(skillsListOptions(owner, query, page, pageSize));
  const assignment = useMainAgentAssignment(owner);
  const lastPage = skills.data
    ? Math.max(1, Math.ceil(skills.data.total / pageSize))
    : page;
  // A page past the end (after deletes, or from an old link) moves back.
  useEffect(() => {
    if (page > lastPage) update({ page: lastPage });
  });
  const openEditor = (target: HTMLElement, id: string | null) => {
    returnFocus.current = target;
    setEditing({ id });
  };
  return (
    <SettingsPane
      title="Skills"
      description="Your private SKILL.md instruction documents."
      actions={
        <Button
          ref={newButton}
          onClick={(event) => openEditor(event.currentTarget, null)}
        >
          New skill
        </Button>
      }
    >
      <SkillAvailability owner={owner} />
      <SettingsSection
        title="Your skills"
        description={
          assignment.selection ? (
            <span role="status">
              {assignment.selection.length} of {MAX_ASSIGNED} assigned to your
              main agent.
            </span>
          ) : undefined
        }
      >
        <Field>
          <FieldLabel htmlFor="skill-search">Search skills</FieldLabel>
          <Input
            id="skill-search"
            maxLength={200}
            value={query}
            onChange={(event) => update({ query: event.target.value, page: 1 })}
          />
        </Field>
        {assignment.assignments.error && (
          <QueryError
            error={assignment.assignments.error}
            message="Could not load which skills are assigned to your main agent."
            retry={assignment.assignments.refetch}
            isRetrying={assignment.assignments.isFetching}
          />
        )}
        {assignment.mutation.error && (
          <SkillFailure
            error={assignment.mutation.error}
            title="Could not change the assignment"
          />
        )}
        {skills.isPending && (
          <ListSkeleton label="Loading skills…" rows={3} detail />
        )}
        {skills.error && (
          <QueryError
            error={skills.error}
            message={
              skills.data
                ? "Could not refresh skills. Showing saved results."
                : "Could not load skills."
            }
            retry={skills.refetch}
            isRetrying={skills.isFetching}
          />
        )}
        {skills.data?.total === 0 && (
          <EmptyState
            title={query ? "No matching skills" : "No skills yet"}
            help={query ? undefined : <HelpTopic id="concept.skill" />}
            description={
              query
                ? "Try a different name or description."
                : "Create a skill from a SKILL.md template, assign it to your main agent, then use it in any chat with /."
            }
            action={
              query ? (
                <Button
                  variant="outline"
                  onClick={() => update({ query: "", page: 1 })}
                >
                  Clear search
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={(event) => openEditor(event.currentTarget, null)}
                >
                  Create a skill
                </Button>
              )
            }
          />
        )}
        {!!skills.data?.items.length && (
          <ul aria-label="Your skills" className="min-w-0 divide-y border-y">
            {skills.data.items.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                assignment={assignment}
                onEdit={(target) => openEditor(target, skill.id)}
              />
            ))}
          </ul>
        )}
        {!!skills.data?.total && (
          <SkillPager
            page={Math.min(page, lastPage)}
            lastPage={lastPage}
            pageSize={pageSize}
            total={skills.data.total}
            busy={skills.isFetching}
            onPage={(next) => update({ page: next })}
            onPageSize={(next) => update({ pageSize: next, page: 1 })}
          />
        )}
      </SettingsSection>
      {editing && (
        <SkillEditorDialog
          owner={owner}
          skillId={editing.id}
          onClose={(deleted) => {
            if (deleted) returnFocus.current = null;
            setEditing(null);
          }}
          restoreFocus={() => {
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
            else newButton.current?.focus();
          }}
        />
      )}
    </SettingsPane>
  );
}

/**
 * Assigns or unassigns one skill at a time against the main agent's loaded
 * revision, like the Agents dialog. A stale revision fails with a conflict;
 * the assignments then reload so the switches show the current state.
 */
function useMainAgentAssignment(owner: string) {
  const queryClient = useQueryClient();
  const options = skillAssignmentsOptions(owner);
  const assignments = useQuery(options);
  const mutation = useMutation({
    ...mainAgentSkillsUpdateMutation({ client }),
    meta: { invalidates: skillMutationInvalidates() },
    onSuccess: (data) => queryClient.setQueryData(options.queryKey, data),
    onError: () => void assignments.refetch(),
  });
  // While a change is saving, the switches show where it is going.
  const selection = mutation.isPending
    ? mutation.variables.body.skill_ids
    : assignments.data?.skill_ids;
  const toggle = (skillId: string, assign: boolean) => {
    const current = assignments.data;
    if (!current || mutation.isPending) return;
    const ids = new Set(current.skill_ids);
    if (assign) ids.add(skillId);
    else ids.delete(skillId);
    mutation.mutate({
      body: { skill_ids: [...ids], expected_revision: current.revision },
    });
  };
  return { assignments, mutation, selection, toggle };
}

function SkillRow({
  skill,
  assignment,
  onEdit,
}: {
  skill: SkillSummary;
  assignment: ReturnType<typeof useMainAgentAssignment>;
  onEdit: (target: HTMLElement) => void;
}) {
  const { selection, mutation, toggle } = assignment;
  const assigned = !!selection?.includes(skill.id);
  const full = !!selection && selection.length >= MAX_ASSIGNED;
  const switchId = `skill-row-assign-${skill.id}`;
  return (
    <li className="grid min-w-0 gap-x-6 gap-y-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium wrap-anywhere">{skill.name}</p>
        <p className="text-muted-foreground text-sm wrap-anywhere">
          {skill.description}
        </p>
        <p className="text-muted-foreground text-xs">
          Revision {skill.revision}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          aria-label={`${skill.name} assigned to main agent`}
          checked={assigned}
          disabled={!selection || mutation.isPending || (!assigned && full)}
          onCheckedChange={(value) => toggle(skill.id, value)}
        />
        <label htmlFor={switchId} className="text-sm">
          Assigned to main agent
        </label>
      </div>
      <Button
        variant="outline"
        className="w-fit"
        aria-label={`View or edit ${skill.name}`}
        onClick={(event) => onEdit(event.currentTarget)}
      >
        View or edit
      </Button>
    </li>
  );
}

function SkillPager({
  page,
  lastPage,
  pageSize,
  total,
  busy,
  onPage,
  onPageSize,
}: {
  page: number;
  lastPage: number;
  pageSize: number;
  total: number;
  busy: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label="Skill pages"
      className="flex min-w-0 flex-wrap items-center justify-between gap-3"
    >
      <p role="status" className="text-muted-foreground text-sm">
        {first}–{last} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="skill-page-size" className="text-sm">
            Per page
          </label>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSize(Number(value))}
          >
            <SelectTrigger id="skill-page-size" size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SKILL_PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {lastPage > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || busy}
              onClick={() => onPage(page - 1)}
            >
              Previous skills
            </Button>
            <span className="text-sm">
              Page {page} of {lastPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === lastPage || busy}
              onClick={() => onPage(page + 1)}
            >
              Next skills
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}
