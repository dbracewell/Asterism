import { SummaryGenerate } from "@/features/study/components/summary-generate";

export default async function NewSummaryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <SummaryGenerate projectId={projectId} />;
}
