import { notFound } from "next/navigation";
import { ProjectsHarness } from "./projects-harness";
export default async function ProjectsTestPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ProjectsHarness view={(await searchParams).view ?? "list"} />;
}
