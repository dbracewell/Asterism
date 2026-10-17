import { notFound } from "next/navigation";
import { ProjectsHarness } from "./projects-harness";
export default async function ProjectsTestPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; projectId?: string }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  const params = await searchParams;
  return (
    <ProjectsHarness
      view={params.view ?? "list"}
      projectId={params.projectId}
    />
  );
}
