"use client";
import MarkdownViewer from "@/components/markdown-viewer";
import {
  adversarialMarkdown,
  normalMarkdown,
  fencedCode,
} from "@/components/markdown-viewer/test-content";
import { SubAgentActivityPanel } from "@/features/chat/components/sub-agent-activity";
import { RetrievalCitations } from "@/features/chat/components/retrieval-citations";
import { FileView } from "@/features/files/file-view";
import type { ToolResult } from "@/lib/client";

const results = [
  {
    tool_call: { function: { name: "search_knowledge" } },
    raw_result: {
      results: [
        {
          file_id: "11111111-1111-4111-8111-111111111111",
          sources: ["chat"],
          artifact_generation: 1,
          chunk_id: "synthetic",
          score: 1,
          match_kind: "text",
        },
      ],
    },
  },
] as ToolResult[];

export function MarkdownHarness() {
  return (
    <main className="flex h-dvh flex-col gap-6 overflow-auto p-6">
      <h1>Rich content verification</h1>
      <section aria-label="Main reply">
        <MarkdownViewer
          content={
            normalMarkdown + "\n" + fencedCode + "\n" + adversarialMarkdown
          }
        />
      </section>
      <SubAgentActivityPanel
        activities={[
          {
            executionId: "synthetic",
            parentExecutionId: null,
            modelName: null,
            subAgentId: "synthetic",
            name: "Content reviewer",
            depth: 1,
            status: "completed",
            content: adversarialMarkdown + "\n" + normalMarkdown,
            thinking: "",
            toolCalls: [],
          },
        ]}
      />
      <RetrievalCitations chatId="example-chat" results={results} />
      <section aria-label="File preview">
        <FileView filename="fixture.md" />
      </section>
    </main>
  );
}
