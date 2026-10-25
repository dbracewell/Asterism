"use client";

import { useUser } from "@/features/auth/components/user-context";
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
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
    <section
      aria-label="Skills management"
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold">Skills</h1>
          <p className="text-muted-foreground text-sm">
            Your private SKILL.md instruction documents.
          </p>
        </div>
        <Button
          ref={newButton}
          onClick={(event) => {
            returnFocus.current = event.currentTarget;
            setEditing({ id: null });
          }}
        >
          New skill
        </Button>
      </header>
      <SkillAvailability owner={owner} />
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
      {skills.isPending && <p role="status">Loading skills…</p>}
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
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {query ? "No matching skills" : "No skills yet"}
            </EmptyTitle>
            <EmptyDescription>
              Create a skill from a SKILL.md template to get started.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {skills.data?.items.map((skill) => (
        <Card key={skill.id} className="min-w-0">
          <CardHeader>
            <CardTitle className="wrap-anywhere">{skill.name}</CardTitle>
            <CardDescription className="wrap-anywhere">
              {skill.description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Revision {skill.revision}
            </p>
          </CardContent>
          <CardFooter className="justify-end">
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
          </CardFooter>
        </Card>
      ))}
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
    </section>
  );
}
