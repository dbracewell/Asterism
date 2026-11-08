"use client";

import { HelpTopic } from "@/features/help/components/help-topic";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import { chatSessionGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

/**
 * A workspace's chats, newest first. With ``recent`` it shows only the first
 * few and links to the full list instead of paging.
 */
export function WorkspaceChats({
  projectId,
  recent,
}: {
  projectId: string | null;
  recent?: { limit: number; showAll: () => void };
}) {
  const [page, setPage] = useState(1);
  const pageSize = recent?.limit ?? 20;
  const chats = useQuery({
    ...chatSessionGetManyOptions({
      client,
      query: { project_id: projectId, page, page_size: pageSize },
    }),
    retry: false,
  });
  return (
    <section
      className="flex flex-col gap-4"
      aria-label={recent ? "Recent chats" : "Workspace chats"}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-heading">{recent ? "Recent chats" : "Chats"}</h2>
        <Button asChild>
          <Link href={projectId ? `/?project_id=${projectId}` : "/"}>
            New chat
          </Link>
        </Button>
      </div>
      {chats.isPending && <ListSkeleton label="Loading chats" rows={5} />}
      {chats.error && (
        <QueryError
          error={chats.error}
          message={
            chats.data
              ? "Could not refresh chats. Showing saved results."
              : "Could not load chats."
          }
          retry={chats.refetch}
          isRetrying={chats.isFetching}
        />
      )}
      {chats.data && (
        <>
          {chats.data.chats.length === 0 ? (
            <EmptyState
              title="No chats yet"
              description={
                projectId
                  ? "Chats you start here can use this project's shared files."
                  : "Start a General chat for a quick question that only needs the files you attach."
              }
              help={
                <HelpTopic
                  id={projectId ? "concept.project" : "concept.general-chat"}
                />
              }
              action={
                <Button asChild variant="outline">
                  <Link href={projectId ? `/?project_id=${projectId}` : "/"}>
                    Start a chat
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {chats.data.chats.map((chat) => (
                <li key={chat.id} className="py-3">
                  <Link href={`/c/${chat.id}`} className="hover:underline">
                    {chat.title || "Untitled chat"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {recent ? (
            chats.data.total > recent.limit && (
              <Button
                variant="outline"
                className="self-start"
                onClick={recent.showAll}
              >
                All {chats.data.total} chats
              </Button>
            )
          ) : (
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                disabled={page === 1 || chats.isFetching}
                onClick={() => setPage(page - 1)}
              >
                Previous chats
              </Button>
              <span className="text-muted-foreground text-sm">Page {page}</span>
              <Button
                variant="outline"
                disabled={
                  page * pageSize >= chats.data.total || chats.isFetching
                }
                onClick={() => setPage(page + 1)}
              >
                Next chats
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
