"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { client } from "@/lib/api";
import type { ChatFileScope } from "@/lib/client";
import {
  chatFileGetInfoOptions,
  chatFileGetScopeOptions,
  chatFileRemoveMutation,
  projectFileAddManyMutation,
  projectFileGetManyOptions,
  projectGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryError } from "@/components/query-error";
import { KnowledgeStatus } from "@/components/file-manager/knowledge-status";
import { useConfirmationDialog } from "@/components/confirmation-dialog";

export const scopedFileHref = (chatId: string, fileId: string) =>
  `/c/${encodeURIComponent(chatId)}/files/${encodeURIComponent(fileId)}`;

export function ChatFileContext({
  open,
  onOpenChange,
  chatId,
  projectId,
  scopeKey,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId?: string;
  projectId: string | null;
  scopeKey?: string;
  disabled?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Files in context</DialogTitle>
          <DialogDescription>
            {projectId
              ? "Project files shared with every chat, plus attachments in this chat."
              : "Only attachments in this chat are available."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-1 text-xs">
          {chatId ? (
            <SavedFileContext
              key={`${chatId}:${scopeKey}`}
              chatId={chatId}
              disabled={disabled}
            />
          ) : (
            <DraftProjectFiles key={projectId} projectId={projectId} />
          )}
        </div>
        {chatId && (
          <p className="text-muted-foreground text-xs">
            Attachments apply to the active branch of this conversation. Earlier
            answers may retain information after removal.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
function SavedFileContext({
  chatId,
  disabled,
}: {
  chatId: string;
  disabled?: boolean;
}) {
  const scope = useQuery({
    ...chatFileGetScopeOptions({ client, path: { chat_id: chatId } }),
    staleTime: 0,
    retry: false,
  });
  if (scope.error)
    return (
      <QueryError
        error={scope.error}
        message="Could not verify current file scope."
        retry={scope.refetch}
        isRetrying={scope.isFetching}
      />
    );
  if (scope.isPending || scope.isFetching)
    return <p role="status">Updating file scope…</p>;
  return (
    <>
      <FileScopeGroup
        key={`project:${scope.data.project_id}`}
        chatId={chatId}
        source="project"
        scope={scope.data}
        disabled={disabled}
      />
      <FileScopeGroup
        key={`chat:${scope.data.project_id}`}
        chatId={chatId}
        source="chat"
        scope={scope.data}
        disabled={disabled}
      />
      {!!scope.data.unavailable_file_ids.length && (
        <p role="status">
          {scope.data.unavailable_file_ids.length} historical attachment(s)
          unavailable in this branch. Library or project membership must be
          explicitly restored to use them.
        </p>
      )}
    </>
  );
}
function FileScopeGroup({
  chatId,
  source,
  scope,
  disabled,
}: {
  chatId: string;
  source: "project" | "chat";
  scope: ChatFileScope;
  disabled?: boolean;
}) {
  const [page, setPage] = useState(0);
  const files = scope.files.filter((file) => file.sources.includes(source));
  const maxPage = Math.max(0, Math.ceil(files.length / 5) - 1);
  const current = Math.min(page, maxPage);
  return (
    <section
      aria-label={source === "project" ? "Project files" : "Chat attachments"}
      className="flex flex-col gap-2 py-2"
    >
      <h3 className="font-medium">
        {source === "project" ? "Project files" : "Chat attachments"} (
        {files.length})
      </h3>
      {!files.length && (
        <p>
          {source === "project"
            ? scope.project_id
              ? "No files shared in this project."
              : "General has no project files."
            : "No saved attachments in this active branch."}
        </p>
      )}
      {files.slice(current * 5, current * 5 + 5).map((file) => (
        <ScopedFileRow
          key={file.file_id}
          chatId={chatId}
          fileId={file.file_id}
          local={source === "chat"}
          projectId={scope.project_id}
          alreadyShared={file.sources.includes("project")}
          disabled={disabled}
        />
      ))}
      {files.length > 5 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Previous {source} files
          </Button>
          <span>
            {current + 1} / {maxPage + 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={current === maxPage}
            onClick={() => setPage(current + 1)}
          >
            Next {source} files
          </Button>
        </div>
      )}
    </section>
  );
}
function ScopedFileRow({
  chatId,
  fileId,
  local,
  projectId,
  alreadyShared,
  disabled,
}: {
  chatId: string;
  fileId: string;
  local: boolean;
  projectId: string | null;
  alreadyShared: boolean;
  disabled?: boolean;
}) {
  const file = useQuery({
    ...chatFileGetInfoOptions({
      client,
      path: { chat_id: chatId, file_id: fileId },
    }),
    retry: false,
  });
  const remove = useMutation(chatFileRemoveMutation({ client }));
  const { confirm, dialog } = useConfirmationDialog({
    title: "Remove this chat attachment?",
    description:
      "This removes local access across this chat's branches. The library file, processing artifacts, and project memberships remain. Historical messages keep their attachment snapshot.",
  });
  if (file.error)
    return (
      <QueryError
        error={file.error}
        message="File unavailable in current chat scope."
        retry={file.refetch}
        isRetrying={file.isFetching}
      />
    );
  if (!file.data) return <p role="status">Loading file…</p>;
  return (
    <div className="bg-card rounded-surface flex flex-wrap items-center gap-2 border p-2.5">
      <Link
        className="break-all underline"
        href={scopedFileHref(chatId, fileId)}
      >
        {file.data.original_name}
      </Link>
      <Badge variant="outline">{local ? "This chat" : "Project"}</Badge>
      <KnowledgeStatus filename={file.data.filename} projects={[]} />
      {local && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || remove.isPending}
            onClick={async () => {
              if (await confirm())
                remove.mutate({ path: { chat_id: chatId, file_id: fileId } });
            }}
          >
            Remove chat attachment
          </Button>
          {dialog}
          {projectId && !alreadyShared && (
            <AddAttachmentToProject
              projectId={projectId}
              fileId={fileId}
              disabled={disabled}
            />
          )}
        </>
      )}
      {remove.error && (
        <QueryError
          error={remove.error}
          message="Could not remove chat attachment."
          retry={() =>
            remove.mutate({ path: { chat_id: chatId, file_id: fileId } })
          }
          isRetrying={remove.isPending}
        />
      )}
    </div>
  );
}
export function AddAttachmentToProject({
  projectId,
  fileId,
  disabled,
}: {
  projectId: string;
  fileId: string;
  disabled?: boolean;
}) {
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId } }),
    retry: false,
  });
  const add = useMutation(projectFileAddManyMutation({ client }));
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          disabled ||
          add.isPending ||
          !project.data ||
          !!project.error ||
          project.isFetching ||
          add.isSuccess
        }
        onClick={() => {
          if (project.data)
            add.mutate({
              path: { project_id: projectId },
              body: {
                expected_context_revision: project.data.context_revision,
                file_ids: [fileId],
              },
            });
        }}
      >
        {add.isSuccess ? "Added to project" : "Add to project"}
      </Button>
      {(add.error || project.error) && (
        <QueryError
          error={add.error ?? project.error}
          message="Could not add to project. Refresh its revision before retrying."
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
    </>
  );
}
function DraftProjectFiles({ projectId }: { projectId: string | null }) {
  const [page, setPage] = useState(1);
  const files = useQuery({
    ...projectFileGetManyOptions({
      client,
      path: { project_id: projectId ?? "" },
      query: { page, page_size: 5 },
    }),
    enabled: !!projectId,
    retry: false,
  });
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Project files</h3>
      {!projectId ? (
        <p className="text-muted-foreground">
          General has no project files. Files you attach are added to this chat
          when the message is sent.
        </p>
      ) : files.error ? (
        <QueryError
          error={files.error}
          message="Could not load project files."
          retry={files.refetch}
          isRetrying={files.isFetching}
        />
      ) : files.isPending || files.isFetching ? (
        <p role="status">Loading project files…</p>
      ) : (
        <>
          {!files.data.files.length && <p>No project files.</p>}
          {files.data.files.map((file) => (
            <div key={file.id}>
              <Link
                className="break-all underline"
                href={`/files/${encodeURIComponent(file.filename)}`}
              >
                {file.original_name}
              </Link>
              <KnowledgeStatus filename={file.filename} projects={[]} />
            </div>
          ))}
          {(files.data.total ?? 0) > 5 && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous project files
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page * 5 >= (files.data.total ?? 0)}
                onClick={() => setPage(page + 1)}
              >
                Next project files
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
