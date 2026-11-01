"use client";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import { studyNoteGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { noteDescription } from "./note-page";

const PAGE_SIZE = 20;

export function ProjectStudyNotes({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1);
  const notes = useQuery({
    ...studyNoteGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page, page_size: PAGE_SIZE },
    }),
    retry: false,
  });
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href={`/projects/${projectId}/study/summaries/new`}>
          Summarize files
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={`/projects/${projectId}/study/guides/new`}>
          Plan for an exam
        </Link>
      </Button>
    </div>
  );
  return (
    <section className="flex flex-col gap-4" aria-label="Study notes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading">Study notes</h2>
        {notes.data && notes.data.total > 0 && actions}
      </div>
      {notes.isPending && <ListSkeleton label="Loading notes" rows={2} />}
      {notes.error && (
        <QueryError
          error={notes.error}
          message={
            notes.data
              ? "Could not refresh notes. Showing saved results."
              : "Could not load notes."
          }
          retry={notes.refetch}
          isRetrying={notes.isFetching}
        />
      )}
      {notes.data &&
        (notes.data.total === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Summarize this project's files or plan your study days before an exam, then save the result as a note."
            action={actions}
          />
        ) : (
          <>
            <ul className="divide-y">
              {notes.data.items.map((note) => (
                <li
                  key={note.id}
                  className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                >
                  <Link
                    href={`/projects/${projectId}/study/notes/${note.id}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {note.title}
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {noteDescription(note)}
                  </span>
                </li>
              ))}
            </ul>
            {notes.data.total > PAGE_SIZE && (
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={page === 1 || notes.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  Previous notes
                </Button>
                <span className="text-muted-foreground text-sm">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  disabled={
                    page * PAGE_SIZE >= notes.data.total || notes.isFetching
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Next notes
                </Button>
              </div>
            )}
          </>
        ))}
    </section>
  );
}
