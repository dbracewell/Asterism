import { notFound } from "next/navigation";

import { KnowledgeBaseDetail } from "@/features/knowledge/knowledge-base-detail";

const KNOWLEDGE_BASE_ID = "10000000-0000-4000-8000-000000000001";

export default function KnowledgeCaptionE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <KnowledgeBaseDetail knowledgeBaseId={KNOWLEDGE_BASE_ID} />;
}
