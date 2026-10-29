"use client";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { useUser } from "@/features/auth/components/user-context";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { skillsListOptions } from "../queries";
import { SkillAvailability } from "./skill-status";
import { SkillEditorDialog } from "./skill-editor-dialog";

export function SkillsSettings() {
  const user = useUser();
  return <OwnedSkillsSettings key={user.id} owner={user.id} />;
}

function OwnedSkillsSettings({ owner }: { owner: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const skills = useQuery(skillsListOptions(owner, query, page));
  const lastPage = skills.data
    ? Math.max(1, Math.ceil(skills.data.total / 10))
    : page;
  if (page > lastPage) setPage(lastPage);
  return (
    <SettingsPane
      title="Skills"
      description="Your private SKILL.md instruction documents."
      actions={
        <Button
          ref={newButton}
          onClick={(event) => {
            returnFocus.current = event.currentTarget;
            setEditing({ id: null });
          }}
        >
          New skill
        </Button>
      }
    >
      <SkillAvailability owner={owner} />
      <SettingsSection title="Your skills">
        <Field>
          <FieldLabel htmlFor="skill-search">Search skills</FieldLabel>
          <Input
            id="skill-search"
            maxLength={200}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </Field>
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
            description={
              query
                ? "Try a different name or description."
                : "Create a skill from a SKILL.md template to reuse instructions in chat."
            }
            action={
              query ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setPage(1);
                  }}
                >
                  Clear search
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setEditing({ id: null });
                  }}
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
              <li
                key={skill.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
              >
                <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                  <p className="font-medium wrap-anywhere">{skill.name}</p>
                  <p className="text-muted-foreground text-sm wrap-anywhere">
                    {skill.description}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Revision {skill.revision}
                  </p>
                </div>
                <Button
                  variant="outline"
                  aria-label={`View or edit ${skill.name}`}
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setEditing({ id: skill.id });
                  }}
                >
                  View or edit
                </Button>
              </li>
            ))}
          </ul>
        )}
        {skills.data && skills.data.total > 10 && (
          <nav
            aria-label="Skill pages"
            className="flex flex-wrap items-center justify-end gap-3"
          >
            <Button
              variant="outline"
              disabled={page === 1 || skills.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous skills
            </Button>
            <span>
              Page {page} of {lastPage}
            </span>
            <Button
              variant="outline"
              disabled={page === lastPage || skills.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next skills
            </Button>
          </nav>
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
