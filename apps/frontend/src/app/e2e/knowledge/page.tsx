import { notFound } from "next/navigation";

import { KnowledgeBaseManager } from "@/features/knowledge/knowledge-base-manager";

export default function KnowledgeE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <KnowledgeBaseManager />;
}
