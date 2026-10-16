"use client";

import * as FileManager from "@/components/file-manager";
import { useFileManager } from "@/components/file-manager/context";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
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
import { client } from "@/lib/api";
import {
  projectFileAddManyMutation,
  projectFileRemoveManyMutation,
  projectGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import type { UserFile } from "@/lib/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

const projectActions = { upload: true, delete: false, regenerate: true };
const pickerActions = { upload: false, delete: false, regenerate: false };

export function ProjectFiles({ projectId }: { projectId: string }) {
  const project = useQuery(
    projectGetOneOptions({ client, path: { project_id: projectId } }),
  );
  const add = useMutation(projectFileAddManyMutation({ client }));
  async function onUploaded(files: UserFile[]) {
    // Upload and membership are separate operations. Never lose the uploaded
    // library files if the project revision changed while uploading.
    if (!project.data || project.error) {
      toast.error(
        "Files uploaded to the library. Reload the project to add them.",
      );
      return;
    }
    try {
      await add.mutateAsync({
        path: { project_id: projectId },
        body: {
          expected_context_revision: project.data.context_revision,
          file_ids: files.map((file) => file.id),
        },
      });
    } catch {
      toast.error(
        "Files uploaded to the library, but could not be added to the project. Reload and add them from the library.",
      );
    }
  }
  return (
    <section
      aria-label="Project files"
      className="flex min-h-96 flex-col gap-3"
    >
      <h2 className="text-lg font-semibold">Project files</h2>
      <p className="text-muted-foreground text-sm">
        Files here are shared with chats in this project. Removing a file keeps
        it in your library and other projects.
      </p>
      <div className="relative flex min-h-96 flex-col overflow-hidden rounded-lg border">
        <FileManager.Provider
          key={projectId}
          source={{ kind: "project", projectId }}
          actions={projectActions}
          onUploaded={onUploaded}
        >
          <FileManager.UploadFileDropZone>
            <FileManager.Ribbon>
              <FileManager.UploadFilesSection />
              <ProjectMembershipActions projectId={projectId} />
            </FileManager.Ribbon>
            <FileManager.FileList />
          </FileManager.UploadFileDropZone>
        </FileManager.Provider>
      </div>
    </section>
  );
}

function ProjectMembershipActions({ projectId }: { projectId: string }) {
  const {
    files,
    selectedFiles,
    setSelectedFiles,
    isMutating,
    setIsMutating,
    dispatch,
  } = useFileManager();
  const project = useQuery(
    projectGetOneOptions({ client, path: { project_id: projectId } }),
  );
  const remove = useMutation({
    ...projectFileRemoveManyMutation({ client }),
    onMutate: () => setIsMutating(true),
    onSettled: () => setIsMutating(false),
    onSuccess: () => {
      setSelectedFiles([]);
      dispatch({ property: "page", value: 1 });
    },
  });
  const { confirm, Dialog: Confirmation } = useConfirmationDialog({
    title: "Remove selected files from this project?",
    description:
      "Only this project's memberships are removed. Library files, processing artifacts, other projects, and chat-local attachments remain. Future turns lose project access to these files; historical answers may retain information.",
  });
  return (
    <FileManager.RibbonSection title="Project">
      <AddProjectFilesDialog projectId={projectId} disabled={isMutating} />
      <Button
        variant="outline"
        disabled={
          !selectedFiles.length ||
          isMutating ||
          remove.isPending ||
          !project.data ||
          !!project.error ||
          project.isFetching
        }
        onClick={async () => {
          if (!project.data || !(await confirm())) return;
          remove.mutate({
            path: { project_id: projectId },
            body: {
              expected_context_revision: project.data.context_revision,
              file_ids: files
                .filter((file) => selectedFiles.includes(file.filename))
                .map((file) => file.id),
            },
          });
        }}
      >
        Remove from project
      </Button>
      <Confirmation />
      {remove.error && (
        <QueryError
          error={remove.error}
          message="Could not remove files. Reload the project before retrying."
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
      {project.error && (
        <QueryError
          error={project.error}
          message="Could not load project membership revision."
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
    </FileManager.RibbonSection>
  );
}

export function AddProjectFilesDialog({
  projectId,
  disabled = false,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Add library files
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add files to this project</DialogTitle>
          <DialogDescription>
            Select library files. Files already in this project cannot be
            selected. Adding a membership reuses existing processing artifacts.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <FileManager.Provider
            source={{ kind: "library" }}
            mode="picker"
            actions={pickerActions}
            isSelectable={(file) =>
              !file.projects?.some((project) => project.id === projectId)
            }
          >
            <FileManager.Ribbon>
              <AddSelection
                projectId={projectId}
                onAdded={() => setOpen(false)}
              />
            </FileManager.Ribbon>
            <FileManager.FileList />
          </FileManager.Provider>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddSelection({
  projectId,
  onAdded,
}: {
  projectId: string;
  onAdded: () => void;
}) {
  const { files, selectedFiles } = useFileManager();
  const project = useQuery(
    projectGetOneOptions({ client, path: { project_id: projectId } }),
  );
  const add = useMutation({
    ...projectFileAddManyMutation({ client }),
    onSuccess: onAdded,
  });
  return (
    <FileManager.RibbonSection title="Add">
      <Button
        disabled={
          !selectedFiles.length ||
          add.isPending ||
          !project.data ||
          !!project.error ||
          project.isFetching
        }
        onClick={() => {
          if (!project.data) return;
          add.mutate({
            path: { project_id: projectId },
            body: {
              expected_context_revision: project.data.context_revision,
              file_ids: files
                .filter((file) => selectedFiles.includes(file.filename))
                .map((file) => file.id),
            },
          });
        }}
      >
        Add selected ({selectedFiles.length})
      </Button>
      {add.error && (
        <QueryError
          error={add.error}
          message="Could not add files. Reload the project before retrying."
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
      {project.error && (
        <QueryError
          error={project.error}
          message="Could not load project."
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
    </FileManager.RibbonSection>
  );
}
