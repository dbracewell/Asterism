import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeStatus } from "./knowledge-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FileKnowledgeArtifact } from "@/lib/client";

const mockGetStatus = vi.fn();

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  fileKnowledgeGetStatusOptions: () => ({
    queryKey: ["file-knowledge", "test.png"],
    queryFn: mockGetStatus,
  }),
  fileKnowledgeRegenerateMutation: () => ({
    mutationFn: vi.fn(),
  }),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

describe("KnowledgeStatus", () => {
  it("renders immediately with provided initialData without query fetch", () => {
    const initialData: FileKnowledgeArtifact = {
      id: "art-1",
      file_id: "file-1",
      generation: 1,
      processing_profile_generation: 1,
      processing_profile_identity: "a".repeat(64),
      contract_version: 1,
      status: "ready",
      is_current: true,
      chunk_count: 5,
      extractions: {
        embedding: {
          kind: "embedding",
          status: "ready",
          payload: { text_ready: true, visual_ready: true },
        },
        captioning: {
          kind: "captioning",
          status: "ready",
          payload: { text: "A diagram" },
        },
      },
      created_at: 100,
      updated_at: 100,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <KnowledgeStatus
            filename="test.png"
            projects={[]}
            initialData={initialData}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Embedding: ready")).toBeInTheDocument();
    expect(screen.getByText("Caption: ready")).toBeInTheDocument();
    expect(mockGetStatus).not.toHaveBeenCalled();
  });
});
