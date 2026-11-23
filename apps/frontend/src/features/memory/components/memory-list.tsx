"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type { Memory } from "@/lib/client";
import {
  memoryDeleteAllMutation,
  memoryDeleteMutation,
  memoryGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn, errorDetail } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  memoryInvalidates,
  sourceLabel,
} from "../lib";
import { MemoryEditorDialog } from "./memory-editor-dialog";

const PAGE_SIZE = 100;

type Scope = { kind: "user" } | { kind: "project"; projectId: string };

/** A person's user memories, or one project's memories, with add, edit and delete. */
export function MemoryList({ scope }: { scope: Scope }) {
  const [page, setPage] = useState(1);
  const query =
    scope.kind === "user"
      ? { kind: "user" as const, page, page_size: PAGE_SIZE }
      : { project_id: scope.projectId, page, page_size: PAGE_SIZE };
  const memories = useQuery({
    ...memoryGetManyOptions({ client, query }),
    retry: false,
  });
  const [editing, setEditing] = useState<Memory | "new" | null>(null);
  const meta = { invalidates: memoryInvalidates() };
  const remove = useMutation({ ...memoryDeleteMutation({ client }), meta });
  const removeAll = useMutation({
    ...memoryDeleteAllMutation({ client }),
    meta,
  });
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const deleteOne = useConfirmationDialog({
    title: "Delete this memory?",
    description:
      "Asterism stops using it in every chat, including replies you resume. This can't be undone.",
    confirmText: "Delete memory",
    confirmVariant: "destructive",
  });
  const total = memories.data?.total ?? 0;
  const where = scope.kind === "user" ? "about you" : "for this project";
  const deleteEvery = useConfirmationDialog({
    title: `Delete all ${total} ${total === 1 ? "memory" : "memories"} ${where}?`,
    description:
      "Asterism stops using them in every chat, including replies you resume. This can't be undone.",
    confirmText: "Delete all",
    confirmVariant: "destructive",
  });
  useHighlightedMemory(memories.data?.items);

  if (memories.isPending) return <ListSkeleton label="Loading memories…" />;
  if (memories.isError)
    return (
      <QueryError
        error={memories.error}
        message="Your memories could not be loaded."
        retry={() => memories.refetch()}
        isRetrying={memories.isFetching}
      />
    );

  const items = memories.data.items;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groups =
    scope.kind === "user"
      ? CATEGORY_ORDER.map((category) => ({
          label: CATEGORY_LABELS[category],
          items: items.filter((item) => item.category === category),
        })).filter((group) => group.items.length > 0)
      : [{ label: null, items }];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setEditing("new")}>
          Add a memory
        </Button>
        {total > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={removeAll.isPending}
            onClick={async () => {
              if (!(await deleteEvery.confirm())) return;
              removeAll.mutate({
                query:
                  scope.kind === "user"
                    ? { kind: "user" }
                    : { project_id: scope.projectId },
              });
            }}
          >
            Delete all
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          className="rounded-surface border p-6"
          title="No memories yet"
          description={
            scope.kind === "user"
              ? "Add something about you, such as how you like to learn, and Asterism takes it into account in every chat."
              : "Add something about your work in this project, such as a decision or a convention, and Asterism takes it into account in this project's chats."
          }
        />
      ) : (
        groups.map((group) => (
          <section
            key={group.label ?? "all"}
            aria-label={group.label ?? "Project memories"}
            className="grid gap-2"
          >
            {group.label && (
              <h3 className="text-sm font-medium">{group.label}</h3>
            )}
            <ul className="grid gap-2">
              {group.items.map((memory) => (
                <MemoryItem
                  key={memory.id}
                  memory={memory}
                  onEdit={() => setEditing(memory)}
                  onDelete={async () => {
                    setDeleting(memory);
                    if (!(await deleteOne.confirm())) return;
                    remove.mutate({
                      path: { memory_id: memory.id },
                      query: { expected_revision: memory.revision },
                    });
                  }}
                  busy={remove.isPending && deleting?.id === memory.id}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {lastPage > 1 && (
        <nav aria-label="Memory pages" className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous memories
          </Button>
          <span className="text-sm">
            Page {page} of {lastPage}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
          >
            Next memories
          </Button>
        </nav>
      )}
      {(remove.error || removeAll.error) && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(
            remove.error ?? removeAll.error,
            "The memory could not be deleted. Reload and try again.",
          )}
        </p>
      )}
      <MemoryEditorDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        scope={scope}
        memory={editing === "new" || editing === null ? undefined : editing}
        onConflict={() => void memories.refetch()}
      />
      {deleteOne.dialog}
      {deleteEvery.dialog}
    </div>
  );
}

function MemoryItem({
  memory,
  onEdit,
  onDelete,
  busy,
}: {
  memory: Memory;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <li
      id={`memory-${memory.id}`}
      tabIndex={-1}
      className={cn(
        "rounded-control grid gap-2 border p-3 outline-offset-2",
        "target:outline-2 focus-visible:outline-2",
      )}
    >
      <p className="text-sm break-words whitespace-pre-wrap">{memory.text}</p>
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        {memory.sensitive && <Badge variant="secondary">Sensitive</Badge>}
        <span>{sourceLabel(memory)}</span>
        <span className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={`Edit memory: ${preview(memory.text)}`}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDelete}
            aria-label={`Delete memory: ${preview(memory.text)}`}
          >
            Delete
          </Button>
        </span>
      </div>
    </li>
  );
}

function preview(text: string) {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** A `?memory=<id>` link (from a reply's details) scrolls to that memory and focuses it. */
function useHighlightedMemory(items: Memory[] | undefined) {
  const wanted = useSearchParams()?.get("memory");
  useEffect(() => {
    if (!wanted || !items?.some((item) => item.id === wanted)) return;
    const node = document.getElementById(`memory-${wanted}`);
    node?.scrollIntoView({ block: "center" });
    node?.focus();
  }, [wanted, items]);
}
