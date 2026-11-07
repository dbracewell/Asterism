"use client";

import { PageHeaderSkeleton } from "@/components/loading-skeletons";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { client } from "@/lib/api";
import type { Project, ProjectCreate } from "@/lib/client";
import {
  projectDeleteMutation,
  projectGetOneOptions,
  projectUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ProjectSubAgents } from "./project-sub-agents";
import { ProjectFiles } from "./project-files";
import { ProjectFields } from "./project-fields";
import { WorkspaceChats } from "./workspace-chats";
import { ProjectGoal } from "./project-goal";
import { ReflectionList } from "@/features/reflections/components/reflection-list";
import { AiUseLogDialog } from "@/features/chat/components/ai-use-log/ai-use-log-dialog";
import { ExportPackDialog } from "./export-pack-dialog";
import { ProjectStudyDecks } from "@/features/study/components/project-study-decks";
import { ProjectStudyQuizzes } from "@/features/study/components/project-study-quizzes";
import { ProjectStudyNotes } from "@/features/study/components/project-study-notes";
import { ProjectWeakSpots } from "@/features/study/components/project-weak-spots";
import { ProjectTopicMastery } from "@/features/study/components/project-topic-mastery";

export const PROJECT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "chats", label: "Chats" },
  { value: "files", label: "Files" },
  { value: "study", label: "Study" },
  { value: "reflections", label: "Reflections" },
  { value: "sub-agents", label: "Sub-agents" },
  { value: "settings", label: "Settings" },
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number]["value"];

export function projectTab(value: string | null): ProjectTab {
  return PROJECT_TABS.find((tab) => tab.value === value)?.value ?? "overview";
}

/** A link to one tab of a project; Overview has no `tab` parameter. */
export function projectHref(projectId: string, tab: ProjectTab = "overview") {
  return tab === "overview"
    ? `/projects/${projectId}`
    : `/projects/${projectId}?tab=${tab}`;
}

/**
 * The active tab lives in the URL, so links and the Back button work (US-65.1).
 * Native pushState updates the URL and useSearchParams without a server
 * round trip, so switching tabs never remounts the page or loses focus.
 */
function useProjectTab() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = projectTab(searchParams.get("tab"));
  const select = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const search = params.toString();
    window.history.pushState(
      null,
      "",
      search ? `${pathname}?${search}` : pathname,
    );
  };
  return [tab, select] as const;
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const [logOpen, setLogOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [tab, selectTab] = useProjectTab();
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId } }),
    retry: false,
  });
  const disabled = project.isFetching || !!project.error;
  return (
    <PageLayout>
      <Link
        href="/projects"
        className="text-muted-foreground text-sm hover:underline"
      >
        All projects
      </Link>
      {project.isPending && <PageHeaderSkeleton label="Loading project" />}
      {project.error && (
        <QueryError
          error={project.error}
          message={
            project.data
              ? "Could not refresh project. Reload before changing settings."
              : "Could not load project."
          }
          retry={project.refetch}
          isRetrying={project.isFetching}
        />
      )}
      {project.data && (
        <>
          <AiUseLogDialog
            projectId={projectId}
            initialChatIds={[]}
            open={logOpen}
            onOpenChange={setLogOpen}
          />
          <ExportPackDialog
            projectId={projectId}
            projectName={project.data.name}
            open={packOpen}
            onOpenChange={setPackOpen}
          />
          <PageHeader
            title={project.data.name}
            description={project.data.description || "Project workspace"}
            actions={
              <Button variant="outline" onClick={() => setLogOpen(true)}>
                Export AI-use log
              </Button>
            }
          />
          <Tabs value={tab} onValueChange={selectTab} className="min-w-0">
            <TabsList
              aria-label="Project sections"
              className="max-w-full justify-start overflow-x-auto"
            >
              {PROJECT_TABS.map((item) => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className="flex-none"
                  onFocus={(event) =>
                    event.currentTarget.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    })
                  }
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview" className={PANEL}>
              <ProjectGoal
                goal={project.data.goal}
                targetDate={project.data.goal_target_date}
              />
              <WorkspaceChats
                key={projectId}
                projectId={projectId}
                recent={{ limit: 5, showAll: () => selectTab("chats") }}
              />
            </TabsContent>
            <TabsContent value="chats" className={PANEL}>
              <WorkspaceChats key={projectId} projectId={projectId} />
            </TabsContent>
            <TabsContent value="files" className={PANEL}>
              <ProjectFiles key={`files-${projectId}`} projectId={projectId} />
            </TabsContent>
            <TabsContent value="study" className={PANEL}>
              <ProjectStudyDecks
                key={`study-${projectId}`}
                projectId={projectId}
              />
              <ProjectTopicMastery
                key={`mastery-${projectId}`}
                projectId={projectId}
              />
              <ProjectWeakSpots
                key={`weak-${projectId}`}
                projectId={projectId}
              />
              <ProjectStudyQuizzes
                key={`quizzes-${projectId}`}
                projectId={projectId}
              />
              <ProjectStudyNotes
                key={`notes-${projectId}`}
                projectId={projectId}
              />
            </TabsContent>
            <TabsContent value="reflections" className={PANEL}>
              <ReflectionList
                key={`reflections-${projectId}`}
                projectId={projectId}
              />
            </TabsContent>
            <TabsContent value="sub-agents" className={PANEL}>
              <ProjectSubAgents
                key={`agents-${projectId}`}
                projectId={projectId}
                disabled={disabled}
              />
            </TabsContent>
            {/* Kept mounted so unsaved edits survive switching tabs. */}
            <TabsContent
              value="settings"
              forceMount
              hidden={tab !== "settings"}
              className={PANEL}
            >
              <ProjectSettings
                key={projectId}
                project={project.data}
                reload={async () => {
                  const result = await project.refetch();
                  return result.isError ? undefined : result.data;
                }}
                disabled={disabled}
              >
                <section
                  className="flex flex-col items-start gap-3 border-t pt-6"
                  aria-label="Team pack"
                >
                  <h2 className="font-medium">Team pack</h2>
                  <p className="text-muted-foreground text-sm">
                    Share this project&apos;s setup as a file others can import.
                  </p>
                  <Button variant="outline" onClick={() => setPackOpen(true)}>
                    Export team pack
                  </Button>
                </section>
              </ProjectSettings>
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageLayout>
  );
}

const PANEL = "flex min-w-0 flex-col gap-6 pt-4";

function ProjectSettings({
  project,
  disabled,
  reload,
  children,
}: {
  project: Project;
  disabled: boolean;
  reload: () => Promise<Project | undefined>;
  children?: ReactNode;
}) {
  const router = useRouter();
  // Keep the revision paired with the user's draft. Background refetches must not
  // silently pair unsaved edits with a newer revision and overwrite another edit.
  const [draft, setDraft] = useState(project);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...projectUpdateMutation({ client }),
    onSuccess: (updated) => {
      setDraft(updated);
      setSaved(true);
    },
  });
  const remove = useMutation({
    ...projectDeleteMutation({ client }),
    onSuccess: () => router.push("/general"),
  });
  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${project.name}?`,
    description:
      "Chats will move to General with their history and local attachments. Project file memberships and instructions will be removed; library files will remain. Active runs will be canceled. Historical answers may still contain project information.",
    confirmVariant: "destructive",
  });
  const pending = disabled || update.isPending || remove.isPending;
  const value: ProjectCreate = {
    name: draft.name,
    description: draft.description,
    system_prompt: draft.system_prompt,
    accent: draft.accent,
    goal: draft.goal,
    goal_target_date: draft.goal_target_date,
  };
  return (
    <>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.name.trim())
            update.mutate({
              path: { project_id: project.id },
              body: {
                ...value,
                name: draft.name.trim(),
                expected_context_revision: draft.context_revision,
              },
            });
        }}
      >
        <ProjectFields
          value={value}
          disabled={pending}
          onChange={(next) => {
            setSaved(false);
            setDraft({ ...draft, ...next });
          }}
        />
        {update.error && (
          <p role="alert">
            {update.error.detail ?? "Could not save project."} Review the
            current project before retrying.
          </p>
        )}
        {saved && (
          <p role="status">
            Project settings saved. Later turns use these instructions.
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={pending || !draft.name.trim()} type="submit">
            {update.isPending ? "Saving…" : "Save settings"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={async () => {
              const current = await reload();
              if (current) {
                setDraft(current);
                update.reset();
                setSaved(false);
              }
            }}
          >
            Reload current settings
          </Button>
        </div>
      </form>
      {children}
      <section
        className="flex flex-col items-start gap-3 border-t pt-6"
        aria-label="Delete project"
      >
        <h2 className="font-medium">Delete project</h2>
        <p className="text-muted-foreground text-sm">
          Chats will be detached into General. Their history and local
          attachments will remain.
        </p>
        {remove.error && (
          <p role="alert">
            {remove.error.detail ??
              "Could not delete project. Reload and retry."}
          </p>
        )}
        <Button
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            if (await confirm())
              remove.mutate({
                path: { project_id: project.id },
                query: { expected_context_revision: project.context_revision },
              });
          }}
        >
          {remove.isPending ? "Deleting…" : "Delete project"}
        </Button>
      </section>
      {dialog}
    </>
  );
}
