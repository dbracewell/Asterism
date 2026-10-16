import { ProjectWorkspace } from "@/features/projects/components/project-workspace";
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectWorkspace projectId={projectId} settings />;
}
