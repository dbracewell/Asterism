"use client";

import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import type { ProjectCreate } from "@/lib/client";
import {
  projectCreateMutation,
  projectGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProjectFields } from "./project-fields";

export function ProjectList() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const projects = useQuery({
    ...projectGetManyOptions({
      client,
      query: { query, page, page_size: 20, sort_by: "name" },
    }),
    retry: false,
  });
  return (
    <main className="container mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 pt-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-muted-foreground">
            Keep related work, instructions, and chats together.
          </p>
        </div>
        <CreateProjectDialog />
      </header>
      <Input
        aria-label="Search projects"
        placeholder="Search names and descriptions"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
      />
      {projects.isPending && (
        <div role="status" aria-label="Loading projects">
          <Spinner size={24} />
        </div>
      )}
      {projects.error && (
        <QueryError
          error={projects.error}
          message={
            projects.data
              ? "Could not refresh projects. Showing saved results."
              : "Could not load projects."
          }
          retry={projects.refetch}
          isRetrying={projects.isFetching}
        />
      )}
      {projects.data && (
        <>
          {projects.isFetching && <p role="status">Refreshing projects…</p>}
          {projects.data.projects.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {query ? "No matching projects" : "No projects yet"}
                </EmptyTitle>
                <EmptyDescription>
                  {query
                    ? "Try another name or description."
                    : "Create a project, or start a chat in General."}
                </EmptyDescription>
              </EmptyHeader>
              <Button asChild variant="outline">
                <Link href="/general">Open General</Link>
              </Button>
            </Empty>
          ) : (
            <ul className="divide-y">
              {projects.data.projects.map((project) => (
                <li key={project.id} className="py-4">
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    href={`/projects/${project.id}`}
                  >
                    {project.name}
                  </Link>
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                    {project.description || "No description"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={page === 1 || projects.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous projects
            </Button>
            <span className="text-muted-foreground text-sm">
              Page {page} · {projects.data.total} projects
            </span>
            <Button
              variant="outline"
              disabled={page * 20 >= projects.data.total || projects.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next projects
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

function CreateProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ProjectCreate>({
    name: "",
    description: "",
    system_prompt: "",
  });
  const create = useMutation({
    ...projectCreateMutation({ client }),
    onSuccess: (project) => {
      setOpen(false);
      router.push(`/projects/${project.id}`);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) {
          setOpen(next);
          create.reset();
          if (next) setValue({ name: "", description: "", system_prompt: "" });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Give related chats a shared purpose and instructions.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.name.trim())
              create.mutate({ body: { ...value, name: value.name.trim() } });
          }}
        >
          <ProjectFields
            value={value}
            onChange={setValue}
            disabled={create.isPending}
          />
          {create.error && (
            <p role="alert">
              {create.error.detail ?? "Could not create project."}
            </p>
          )}
          <Button
            type="submit"
            disabled={create.isPending || !value.name.trim()}
          >
            {create.isPending ? "Creating…" : "Create project"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
