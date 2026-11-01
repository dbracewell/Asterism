import { GuideGenerate } from "@/features/study/components/guide-generate";

export default async function NewStudyGuidePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <GuideGenerate projectId={projectId} />;
}
