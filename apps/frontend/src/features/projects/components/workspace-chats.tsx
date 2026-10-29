"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { client } from "@/lib/api";
import { chatSessionGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

export function WorkspaceChats({ projectId }: { projectId: string | null }) {
  const [page, setPage] = useState(1);
  const chats = useQuery({
    ...chatSessionGetManyOptions({
      client,
      query: { project_id: projectId, page, page_size: 20 },
    }),
    retry: false,
  });
  return (
    <section className="flex flex-col gap-4" aria-label="Workspace chats">
      <div className="flex items-center justify-between">
        <h2 className="text-heading">Chats</h2>
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
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No chats yet</EmptyTitle>
                <EmptyDescription>
                  Start a chat in this workspace.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
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
              disabled={page * 20 >= chats.data.total || chats.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next chats
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
