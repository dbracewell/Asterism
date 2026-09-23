import { KnowledgeBaseDetail } from "@/features/knowledge/knowledge-base-detail";

type KnowledgeBasePageProps = { params: Promise<{ knowledgeBaseId: string }> };

export default async function KnowledgeBasePage({
  params,
}: KnowledgeBasePageProps) {
  const { knowledgeBaseId } = await params;
  return <KnowledgeBaseDetail knowledgeBaseId={knowledgeBaseId} />;
}
