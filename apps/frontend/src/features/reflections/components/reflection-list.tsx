"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/features/auth/components/user-context";
import { personaQueryOptions } from "@/features/settings/persona-queries";
import { client } from "@/lib/api";
import type { Reflection } from "@/lib/client";
import {
  reflectionDeleteMutation,
  reflectionUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import {
  REFLECTION_PAGE_SIZE,
  reflectionListOptions,
  reflectionMutationInvalidates,
} from "../queries";
import {
  LEARNED_PROMPT,
  MAX_REFLECTION_CHARS,
  UNCLEAR_PROMPT,
} from "./reflect-dialog";
import { UnclearPracticeDialog } from "./unclear-practice-dialog";

const ALL = "all";

/** A project's (or General's) reflections, filterable by persona (US-58.2). */
export function ReflectionList({ projectId }: { projectId: string | null }) {
  const user = useUser();
  return (
    <OwnedReflectionList key={user.id} owner={user.id} projectId={projectId} />
  );
}

function OwnedReflectionList({
  owner,
  projectId,
}: {
  owner: string;
  projectId: string | null;
}) {
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const personas = useQuery(personaQueryOptions(owner));
  const reflections = useQuery(
    reflectionListOptions(owner, { projectId, personaId, page }),
  );
  const names = new Map(
    personas.data?.profiles.map((profile) => [profile.id, profile.name]),
  );
  const lastPage = reflections.data
    ? Math.max(1, Math.ceil(reflections.data.total / REFLECTION_PAGE_SIZE))
    : page;
  if (page > lastPage) setPage(lastPage);
  return (
    <section aria-label="Reflections" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading">Reflections</h2>
        {(personas.data?.profiles.length ?? 0) > 1 && (
          <Select
            value={personaId ?? ALL}
            onValueChange={(value) => {
              setPersonaId(value === ALL ? null : value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Persona" className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All personas</SelectItem>
              {personas.data?.profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {reflections.isPending && (
        <ListSkeleton label="Loading reflections" rows={2} detail />
      )}
      {reflections.error && (
        <QueryError
          error={reflections.error}
          message="Could not load reflections."
          retry={reflections.refetch}
          isRetrying={reflections.isFetching}
        />
      )}
      {reflections.data?.total === 0 && (
        <EmptyState
          title="No reflections yet"
          description="At the end of a session, choose Reflect on this session in the chat's menu to note what you learned and what's still unclear."
        />
      )}
      {!!reflections.data?.items.length && (
        <ul className="flex flex-col gap-3">
          {reflections.data.items.map((reflection) => (
            <ReflectionItem
              key={reflection.id}
              reflection={reflection}
              persona={names.get(reflection.persona_id)}
            />
          ))}
        </ul>
      )}
      {reflections.data && reflections.data.total > REFLECTION_PAGE_SIZE && (
        <nav
          aria-label="Reflection pages"
          className="flex flex-wrap items-center justify-end gap-3"
        >
          <Button
            variant="outline"
            disabled={page === 1 || reflections.isFetching}
            onClick={() => setPage(page - 1)}
          >
            Newer reflections
          </Button>
          <span>
            Page {page} of {lastPage}
          </span>
          <Button
            variant="outline"
            disabled={page === lastPage || reflections.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Older reflections
          </Button>
        </nav>
      )}
    </section>
  );
}

function ReflectionItem({
  reflection,
  persona,
}: {
  reflection: Reflection;
  persona?: string;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [practicing, setPracticing] = useState(false);
  const [learned, setLearned] = useState(reflection.learned);
  const [unclear, setUnclear] = useState(reflection.unclear);
  const update = useMutation({
    ...reflectionUpdateMutation({ client }),
    meta: { invalidates: reflectionMutationInvalidates() },
    onSuccess: () => setEditing(false),
  });
  const remove = useMutation({
    ...reflectionDeleteMutation({ client }),
    meta: { invalidates: reflectionMutationInvalidates() },
  });
  const deletion = useConfirmationDialog({
    title: "Delete this reflection?",
    description: "This permanently deletes the reflection.",
    confirmText: "Delete reflection",
    confirmVariant: "destructive",
  });
  const pending = update.isPending || remove.isPending;
  const when = new Date(reflection.created_at * 1000).toLocaleDateString(
    undefined,
    { dateStyle: "medium" },
  );
  return (
    <li
      aria-label={`Reflection from ${when}`}
      className="border-border rounded-surface flex min-w-0 flex-col gap-2 border p-3"
    >
      {deletion.dialog}
      {reflection.project_id && (
        <UnclearPracticeDialog
          reflection={reflection}
          projectId={reflection.project_id}
          open={practicing}
          onOpenChange={setPracticing}
        />
      )}
      <p className="text-muted-foreground text-xs">
        {when}
        {persona && ` · ${persona}`}
        {reflection.chat_id && (
          <>
            {" · "}
            <Link href={`/chat/${reflection.chat_id}`} className="underline">
              Open chat
            </Link>
          </>
        )}
      </p>
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (learned.trim() || unclear.trim())
              update.mutate({
                path: { reflection_id: reflection.id },
                body: {
                  learned,
                  unclear,
                  expected_revision: reflection.revision,
                },
              });
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-learned`}>{LEARNED_PROMPT}</FieldLabel>
            <Textarea
              id={`${id}-learned`}
              value={learned}
              maxLength={MAX_REFLECTION_CHARS}
              disabled={pending}
              onChange={(event) => setLearned(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-unclear`}>{UNCLEAR_PROMPT}</FieldLabel>
            <Textarea
              id={`${id}-unclear`}
              value={unclear}
              maxLength={MAX_REFLECTION_CHARS}
              disabled={pending}
              onChange={(event) => setUnclear(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setLearned(reflection.learned);
                setUnclear(reflection.unclear);
                update.reset();
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || (!learned.trim() && !unclear.trim())}
            >
              Save changes
            </Button>
          </div>
        </form>
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          {reflection.learned && (
            <div>
              <dt className="font-medium">{LEARNED_PROMPT}</dt>
              <dd className="wrap-anywhere whitespace-pre-wrap">
                {reflection.learned}
              </dd>
            </div>
          )}
          {reflection.unclear && (
            <div>
              <dt className="font-medium">{UNCLEAR_PROMPT}</dt>
              <dd className="wrap-anywhere whitespace-pre-wrap">
                {reflection.unclear}
              </dd>
            </div>
          )}
        </dl>
      )}
      {(update.error || remove.error) && (
        <p role="alert" className="text-destructive text-sm">
          Could not save or delete this reflection. Reload and retry.
        </p>
      )}
      {!editing && (
        <div className="flex flex-wrap justify-end gap-2">
          {reflection.project_id && reflection.unclear && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setPracticing(true)}
            >
              Practice unclear items
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={async () => {
              if (await deletion.confirm())
                remove.mutate({
                  path: { reflection_id: reflection.id },
                  query: { expected_revision: reflection.revision },
                });
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}
