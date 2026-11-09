"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { HelpTopic } from "@/features/help/components/help-topic";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { skillAvailabilityOptions, skillsListOptions } from "../queries";

const PAGE_SIZE = 10;
const MAX_SKILLS = 100;

/**
 * Picks the skills a sub-agent may load on its own (US-75.4, ADR-0062).
 * Selections on other pages and searches are kept.
 */
export function SubAgentSkillsPicker({
  owner,
  selected,
  onChange,
  loading,
  error,
  retry,
  retrying = false,
  modelSupportsTools,
  disabled,
}: {
  owner: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  /** The saved assignments are still loading. */
  loading?: boolean;
  /** The saved assignments could not load; the picker is then read-only. */
  error?: unknown;
  retry?: () => void;
  retrying?: boolean;
  /** The chosen model's tool support; skills are loaded with a tool. */
  modelSupportsTools?: boolean;
  disabled?: boolean;
}) {
  const prefix = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const skills = useQuery(skillsListOptions(owner, query, page, PAGE_SIZE));
  const policy = useQuery(skillAvailabilityOptions(owner));
  const lastPage = skills.data
    ? Math.max(1, Math.ceil(skills.data.total / PAGE_SIZE))
    : page;
  if (page > lastPage) setPage(lastPage);
  const locked = disabled || loading || !!error;
  return (
    <FieldSet className="min-w-0 gap-3">
      <FieldLegend className="flex items-center gap-1">
        Skills <HelpTopic id="concept.skill" />
      </FieldLegend>
      <FieldDescription>
        This sub-agent sees the name and description of each skill you choose
        and loads one when it fits the task. It doesn&apos;t use /.
      </FieldDescription>
      {policy.data && !policy.data.policy_enabled && (
        <p role="note" className="text-sm">
          An administrator has turned skills off. You can still choose skills;
          the sub-agent can load them once skills are turned on.
        </p>
      )}
      {modelSupportsTools === false && selected.length > 0 && (
        <p role="alert" className="text-destructive text-sm">
          The chosen model doesn&apos;t support tools, so this sub-agent
          can&apos;t load its skills. Choose a model that supports tools.
        </p>
      )}
      {loading && <ListSkeleton label="Loading assigned skills…" rows={2} />}
      {!!error && (
        <QueryError
          error={error}
          message="Could not load this sub-agent's skills. Saving keeps them unchanged."
          retry={retry ?? (() => {})}
          isRetrying={retrying}
        />
      )}
      <Field>
        <FieldLabel htmlFor={`${prefix}-search`}>Find skills</FieldLabel>
        <Input
          id={`${prefix}-search`}
          maxLength={200}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      <p role="status" className="text-muted-foreground text-sm">
        {selected.length} selected
        {selected.length > 0 && ". Selections on other pages are kept."}
      </p>
      {skills.isPending && <ListSkeleton label="Loading skills…" rows={3} />}
      {skills.error && (
        <QueryError
          error={skills.error}
          message="Could not load your skills."
          retry={() => void skills.refetch()}
          isRetrying={skills.isFetching}
        />
      )}
      {skills.data?.total === 0 && (
        <p className="text-sm">
          {query
            ? "No matching skills."
            : "You have no skills yet. Create one under Skills."}
        </p>
      )}
      {!!skills.data?.items.length && (
        <FieldGroup className="gap-2">
          {skills.data.items.map((skill) => {
            const checked = selected.includes(skill.id);
            const id = `${prefix}-${skill.id}`;
            return (
              <Field key={skill.id} orientation="horizontal">
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={
                    locked || (!checked && selected.length >= MAX_SKILLS)
                  }
                  onCheckedChange={(value) =>
                    onChange(
                      value === true
                        ? [...selected, skill.id]
                        : selected.filter((item) => item !== skill.id),
                    )
                  }
                />
                <FieldLabel htmlFor={id} className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-col">
                    <span className="wrap-anywhere">{skill.name}</span>
                    <span className="text-muted-foreground font-normal wrap-anywhere">
                      {skill.description}
                    </span>
                  </span>
                </FieldLabel>
              </Field>
            );
          })}
        </FieldGroup>
      )}
      {skills.data && skills.data.total > PAGE_SIZE && (
        <nav
          aria-label="Skill pages"
          className="flex flex-wrap items-center justify-end gap-2"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 1 || skills.isFetching}
            onClick={() => setPage(page - 1)}
          >
            Previous skills
          </Button>
          <span className="text-sm">
            Page {page} of {lastPage}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === lastPage || skills.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Next skills
          </Button>
        </nav>
      )}
    </FieldSet>
  );
}
