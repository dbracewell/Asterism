"use client";
import MarkdownViewer from "@/components/markdown-viewer";
import { VerificationPanel } from "@/features/chat/components/verification/verification-panel";
import type { MessageVerification } from "@/lib/client";
import { useRef } from "react";

export const VERIFY_FILE = "30000000-0000-4000-8000-000000000001";

const verification: MessageVerification = {
  model_id: "30000000-0000-4000-8000-000000000002",
  model_name: "Checker",
  created_at: Date.UTC(2026, 10, 2, 12),
  file_ids: [VERIFY_FILE],
  claims: [
    {
      claim: "The sky is blue.",
      quote: "The sky is blue.",
      label: "supported",
      explanation: "The notes say so.",
      evidence: [
        {
          file_id: VERIFY_FILE,
          chunk_id: "c1",
          artifact_generation: 1,
          name: "notes.md",
          excerpt: 'The sky is blue <img src="/untrusted-evidence/x">.',
          available: true,
        },
      ],
    },
    {
      claim: "Water boils at 50 C.",
      quote: "Water boils at 50 C.",
      label: "contradicted",
      explanation: "The notes say 100 C.",
      evidence: [
        {
          file_id: VERIFY_FILE,
          chunk_id: "c2",
          artifact_generation: 1,
          name: "notes.md",
          excerpt: "Water boils at 100 C.",
          available: true,
        },
      ],
    },
  ],
  usage: {
    claims_found: 2,
    claims_checked: 2,
    claim_limit: 12,
    searches: 2,
    model_calls: 3,
    duration_ms: 1500,
  },
};

export function VerificationHarness() {
  const answerRef = useRef<HTMLDivElement>(null);
  return (
    <main className="flex h-dvh flex-col gap-6 overflow-auto p-6">
      <h1>Verification</h1>
      <div ref={answerRef}>
        <MarkdownViewer content="The **sky** is blue. Water boils at 50 C." />
      </div>
      <VerificationPanel
        chatId="e2e-verify-chat"
        messageId="e2e-verify-message"
        verification={verification}
        answerRef={answerRef}
      />
    </main>
  );
}
