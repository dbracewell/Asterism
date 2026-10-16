"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import type { Project, ProjectCreate } from "@/lib/client";
import {
  projectDeleteMutation,
  projectGetOneOptions,
  projectUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProjectFields } from "./project-fields";
import { WorkspaceChats } from "./workspace-chats";

export function ProjectWorkspace({
  projectId,
  settings = false,
}: {
  projectId: string;
  settings?: boolean;
}) {
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId } }),
    retry: false,
  });
  return (
    <main className="container mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 pt-16">
      <Link
        href="/projects"
        className="text-muted-foreground text-sm hover:underline"
      >
        All projects
      </Link>
      {project.isPending && (
        <div role="status" aria-label="Loading project">
          <Spinner size={24} />
        </div>
      )}
      {project.error && (
        <QueryError
          error={project.error}
          message={
            project.data
              ? "Could not refresh project. Reload before changing settings."
              : "Could not load project."
          }
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
      {project.data && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{project.data.name}</h1>
              <p className="text-muted-foreground">
                {settings
                  ? "Project settings"
                  : project.data.description || "Project workspace"}
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link
                href={
                  settings
                    ? `/projects/${projectId}`
                    : `/projects/${projectId}/settings`
                }
              >
                {settings ? "Overview" : "Project settings"}
              </Link>
            </Button>
          </header>
          {settings ? (
            <ProjectSettings
              key={projectId}
              project={project.data}
              reload={async () => {
                const result = await project.refetch();
                return result.isError ? undefined : result.data;
              }}
              disabled={project.isFetching || !!project.error}
            />
          ) : (
            <WorkspaceChats key={projectId} projectId={projectId} />
          )}
        </>
      )}
    </main>
  );
}

function ProjectSettings({
  project,
  disabled,
  reload,
}: {
  project: Project;
  disabled: boolean;
  reload: () => Promise<Project | undefined>;
}) {
  const router = useRouter();
  // Keep the revision paired with the user's draft. Background refetches must not
  // silently pair unsaved edits with a newer revision and overwrite another edit.
  const [draft, setDraft] = useState(project);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...projectUpdateMutation({ client }),
    onSuccess: (updated) => {
      setDraft(updated);
      setSaved(true);
    },
  });
  const remove = useMutation({
    ...projectDeleteMutation({ client }),
    onSuccess: () => router.push("/general"),
  });
  const { confirm, Dialog } = useConfirmationDialog({
    title: `Delete ${project.name}?`,
    description:
      "Chats will move to General with their history and local attachments. Project file memberships and instructions will be removed; library files will remain. Active runs will be canceled. Historical answers may still contain project information.",
    confirmVariant: "destructive",
  });
  const pending = disabled || update.isPending || remove.isPending;
  const value: ProjectCreate = {
    name: draft.name,
    description: draft.description,
    system_prompt: draft.system_prompt,
  };
  return (
    <>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.name.trim())
            update.mutate({
              path: { project_id: project.id },
              body: {
                ...value,
                name: draft.name.trim(),
                expected_context_revision: draft.context_revision,
              },
            });
        }}
      >
        <ProjectFields
          value={value}
          disabled={pending}
          onChange={(next) => {
            setSaved(false);
            setDraft({ ...draft, ...next });
          }}
        />
        {update.error && (
          <p role="alert">
            {update.error.detail ?? "Could not save project."} Review the
            current project before retrying.
          </p>
        )}
        {saved && (
          <p role="status">
            Project settings saved. Later turns use these instructions.
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={pending || !draft.name.trim()} type="submit">
            {update.isPending ? "Saving…" : "Save settings"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={async () => {
              const current = await reload();
              if (current) {
                setDraft(current);
                update.reset();
                setSaved(false);
              }
            }}
          >
            Reload current settings
          </Button>
        </div>
      </form>
      <section
        className="flex flex-col items-start gap-3 border-t pt-6"
        aria-label="Delete project"
      >
        <h2 className="font-medium">Delete project</h2>
        <p className="text-muted-foreground text-sm">
          Chats will be detached into General. Their history and local
          attachments will remain.
        </p>
        {remove.error && (
          <p role="alert">
            {remove.error.detail ??
              "Could not delete project. Reload and retry."}
          </p>
        )}
        <Button
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            if (await confirm())
              remove.mutate({
                path: { project_id: project.id },
                query: { expected_context_revision: project.context_revision },
              });
          }}
        >
          {remove.isPending ? "Deleting…" : "Delete project"}
        </Button>
      </section>
      <Dialog />
    </>
  );
}
