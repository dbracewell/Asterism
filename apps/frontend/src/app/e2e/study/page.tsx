import { notFound } from "next/navigation";
import { StudyHarness } from "./study-harness";

export default async function StudyTestPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  const params = await searchParams;
  return <StudyHarness view={params.view ?? "deck"} />;
}
