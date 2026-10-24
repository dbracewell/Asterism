import type { FileKnowledgeArtifact } from "../../src/lib/client";

/** A complete generated-contract response, with only the requested outputs. */
export function knowledgeArtifact(
  fileId: string,
  overrides: Partial<FileKnowledgeArtifact> = {},
): FileKnowledgeArtifact {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    file_id: fileId,
    generation: 1,
    processing_profile_generation: 1,
    status: "ready",
    is_current: true,
    chunk_count: 0,
    created_at: 0,
    updated_at: 0,
    extractions: {},
    ...overrides,
  };
}
