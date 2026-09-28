"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Editor } from "@/features/knowledge/knowledge-base-manager/editor";
import { Header } from "@/features/knowledge/knowledge-base-manager/header";
import { NoBases } from "@/features/knowledge/knowledge-base-manager/no-bases";
import { client } from "@/lib/api";
import { ErrorDetail, KnowledgeBase } from "@/lib/client";
import {
  knowledgeBaseDeleteMutation,
  knowledgeBaseGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

const PAGE_SIZE = 50;
type Sort = "name" | "created";

export function KnowledgeBaseManager() {
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const deferredQuery = useDeferredValue(query.trim());

  const {
    data: bases,
    isLoading,
    error,
  } = useQuery(
    knowledgeBaseGetManyOptions({
      client,
      query: {
        page: page,
        page_size: PAGE_SIZE,
        sort_by: sort,
        query: deferredQuery || undefined,
      },
    }),
  );

  const removeMutation = useMutation({
    ...knowledgeBaseDeleteMutation({ client }),
    onSuccess: () => setPage(1),
  });

  const { Dialog, confirm } = useConfirmationDialog({
    description:
      "Are you sure you want to delete this knowledge base and its file memberships? Library files and their derived knowledge remain available.",
    title: "Delete knowledge base",
    confirmVariant: "destructive",
  });

  const remove = async (base: KnowledgeBase) => {
    if (!(await confirm())) return;
    removeMutation.mutate({ path: { knowledge_base_id: base.id } });
  };

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setPage(1);
  };

  const changeSort = (nextSort: Sort) => {
    setSort(nextSort);
    setPage(1);
  };

  const total = bases?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const errorDetail = (error as ErrorDetail | null)?.detail;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <Dialog />
      <Header
        query={query}
        setQuery={changeQuery}
        setSort={changeSort}
        sort={sort}
      />
      <Editor editing={editing} clearEditing={() => setEditing(null)} />
      {error && (
        <p
          className="text-destructive flex items-center justify-center"
          role="alert"
        >
          {errorDetail ?? "Unable to load knowledge bases."}
        </p>
      )}
      {isLoading ? (
        <Spinner />
      ) : bases?.knowledge_bases.length === 0 ? (
        <NoBases />
      ) : (
        <div className="bg-card flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {bases?.knowledge_bases.map((base, index) => (
            <article
              className={cn(
                "flex items-center justify-between gap-4 rounded-lg border p-4",
                index % 2 === 1 && "bg-background text-foreground",
              )}
              key={base.id}
            >
              <div>
                <Link
                  className="font-medium underline"
                  href={`/knowledge/${base.id}`}
                >
                  {base.name}
                </Link>
                {base.description && (
                  <p className="text-muted-foreground text-sm">
                    {base.description}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(base);
                  }}
                >
                  Edit
                </Button>
                <Button
                  aria-label={`Delete ${base.name}`}
                  variant="ghost"
                  size="icon"
                  onClick={() => void remove(base)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!isLoading && total > 0 && (
        <footer className="bg-muted text-muted-foreground flex items-center gap-2 border-t px-4 py-2 text-xs">
          <p>
            {total} total knowledge {total === 1 ? "base" : "bases"}
          </p>
          {deferredQuery && (
            <p className="max-w-100 truncate font-bold">Search: {query}</p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <p className="text-sm">
              Page {page} of {totalPages}
            </p>
            {totalPages > 1 && (
              <div className="flex gap-2">
                <Button
                  disabled={page === 1}
                  onClick={() => setPage((current) => current - 1)}
                  size="sm"
                  variant="secondary"
                >
                  Previous
                </Button>
                <Button
                  disabled={page === totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  size="sm"
                  variant="secondary"
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </footer>
      )}
    </main>
  );
}
