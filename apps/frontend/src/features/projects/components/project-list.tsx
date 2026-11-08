"use client";

import { HelpTopic } from "@/features/help/components/help-topic";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import { projectGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ProjectAccentDot } from "@/features/projects/project-accent";
import { NewProjectWizard } from "./new-project-wizard";

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
    <PageLayout>
      <PageHeader
        title="Projects"
        description="Keep related work, instructions, and chats together."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/team-packs">Import team pack</Link>
            </Button>
            <NewProjectWizard />
          </>
        }
      />
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
        <ListSkeleton label="Loading projects" rows={5} detail />
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
            <EmptyState
              title={query ? "No matching projects" : "No projects yet"}
              help={query ? undefined : <HelpTopic id="concept.project" />}
              description={
                query
                  ? "Try a different name or description."
                  : "Use New project to group related chats and share files with each of them."
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
                  <Button asChild variant="outline">
                    <Link href="/general">Open General</Link>
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y">
              {projects.data.projects.map((project) => (
                <li key={project.id} className="py-4">
                  <Link
                    className="inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline"
                    href={`/projects/${project.id}`}
                  >
                    <ProjectAccentDot accent={project.accent} />
                    {project.name}
                  </Link>
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                    {project.description || "No description"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
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
    </PageLayout>
  );
}
