"use client";
import { turnCapabilities } from "@/features/chat/lib/capability-manifest";
import { turnContext } from "@/features/chat/lib/context-manifest";
import { runUsage } from "@/features/chat/lib/run-usage";
import type { Message } from "@/lib/client";
import React from "react";
import { CapabilityManifestDialog } from "./capability-manifest-dialog";
import { ContextInspectorDialog } from "./context-inspector-dialog";
import { RunUsageSummary } from "./run-usage-summary";

/**
 * The inspection links shown in a final answer's meta line: usage and cost
 * (US-54.1), capabilities (US-54.2) and context (US-54.3). Each part appears only when the turn
 * recorded data for it, with a separator before each visible part.
 */
export function TurnInspection({
  chatId,
  steps,
}: {
  chatId: string;
  steps: Message[];
}) {
  const usage = React.useMemo(() => runUsage(steps), [steps]);
  const hasCapabilities = React.useMemo(
    () => turnCapabilities(steps).length > 0,
    [steps],
  );
  const hasContext = React.useMemo(() => turnContext(steps) != null, [steps]);
  return (
    <>
      {(usage.inputTokens > 0 || usage.outputTokens > 0) && (
        <>
          {" · "}
          <RunUsageSummary steps={steps} />
        </>
      )}
      {hasCapabilities && (
        <>
          {" · "}
          <CapabilityManifestDialog steps={steps} />
        </>
      )}
      {hasContext && (
        <>
          {" · "}
          <ContextInspectorDialog chatId={chatId} steps={steps} />
        </>
      )}
    </>
  );
}
