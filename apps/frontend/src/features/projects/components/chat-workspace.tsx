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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import type { ChatInfo } from "@/lib/client";
import {
  chatSessionMoveMutation,
  projectGetManyOptions,
  projectGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

export function WorkspaceIdentity({ projectId }: { projectId: string | null }) {
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId ?? "" } }),
    enabled: !!projectId,
    retry: false,
  });
  if (!projectId)
    return (
      <div className="flex flex-col gap-1">
        <Link href="/general" className="text-sm hover:underline">
          General
        </Link>
        <p className="text-muted-foreground text-xs">
          General chats never delegate to sub-agents.
        </p>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <Link href={`/projects/${projectId}`} className="text-sm hover:underline">
        {project.data?.name ??
          (project.isPending ? "Loading project…" : "Project unavailable")}
      </Link>
      {project.error && (
        <QueryError
          error={project.error}
          message="Could not refresh project identity."
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
    </div>
  );
}

export function ChatWorkspace({
  info,
  disabled,
}: {
  info: ChatInfo;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 py-3"
      aria-label="Chat workspace"
    >
      <WorkspaceIdentity projectId={info.project_id ?? null} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled}>
            Move chat
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move chat</DialogTitle>
            <DialogDescription>
              This transfers the chat’s full history and local attachments.
              Historical answers may contain information from the previous
              project. Later turns use the destination’s instructions and files.
              Pending generations must be regenerated after a move.
            </DialogDescription>
          </DialogHeader>
          <MoveChatForm
            key={`${info.id}:${info.project_id ?? "general"}`}
            info={info}
            disabled={disabled}
            onMoved={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MoveChatForm({
  info,
  disabled,
  onMoved,
}: {
  info: ChatInfo;
  disabled: boolean;
  onMoved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState({
    id: info.project_id ?? "general",
    name: "Current project",
  });
  const projects = useQuery({
    ...projectGetManyOptions({
      client,
      query: { query, page, page_size: 10, sort_by: "name" },
    }),
    retry: false,
  });
  const move = useMutation({
    ...chatSessionMoveMutation({ client }),
    onSuccess: onMoved,
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        move.mutate({
          path: { chat_id: info.id },
          body: { project_id: target.id === "general" ? null : target.id },
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="destination-search">
            Find destination project
          </FieldLabel>
          <Input
            id="destination-search"
            aria-label="Find destination project"
            placeholder="Find a project"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            disabled={move.isPending || disabled}
          />
        </Field>
        {projects.error && (
          <QueryError
            error={projects.error}
            message="Could not load destinations."
            retry={projects.refetch}
            isRetrying={projects.isFetching}
          />
        )}
        <Field>
          <FieldLabel htmlFor="destination-workspace">
            Destination workspace
          </FieldLabel>
          <Select
            value={target.id}
            disabled={move.isPending || disabled}
            onValueChange={(id) =>
              setTarget({
                id,
                name:
                  projects.data?.projects.find((p) => p.id === id)?.name ??
                  "General",
              })
            }
          >
            <SelectTrigger
              id="destination-workspace"
              aria-label="Destination workspace"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="general">General</SelectItem>
                {target.id !== "general" &&
                  !projects.data?.projects.some((p) => p.id === target.id) && (
                    <SelectItem value={target.id}>{target.name}</SelectItem>
                  )}
                {projects.data?.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
      {projects.isPending && <p role="status">Loading destinations…</p>}
      {projects.data?.projects.length === 0 && (
        <p>No matching projects. You can move this chat to General.</p>
      )}
      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          type="button"
          disabled={page === 1 || projects.isFetching || move.isPending}
          onClick={() => setPage(page - 1)}
        >
          Previous destinations
        </Button>
        <Button
          variant="outline"
          type="button"
          disabled={
            !projects.data ||
            page * 10 >= projects.data.total ||
            projects.isFetching ||
            move.isPending
          }
          onClick={() => setPage(page + 1)}
        >
          Next destinations
        </Button>
      </div>
      {move.error && (
        <p role="alert">
          {move.error.detail ??
            "Could not move chat. Stop any active run and retry."}
        </p>
      )}
      <Button
        type="submit"
        disabled={
          disabled ||
          move.isPending ||
          target.id === (info.project_id ?? "general")
        }
      >
        {move.isPending ? "Moving…" : "Move to workspace"}
      </Button>
    </form>
  );
}
