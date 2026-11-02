"use client";
import { turnCapabilities } from "@/features/chat/lib/capability-manifest";
import { runUsage } from "@/features/chat/lib/run-usage";
import type { Message } from "@/lib/client";
import React from "react";
import { CapabilityManifestDialog } from "./capability-manifest-dialog";
import { RunUsageSummary } from "./run-usage-summary";

/**
 * The inspection links shown in a final answer's meta line: usage and cost
 * (US-54.1) and capabilities (US-54.2). Each part appears only when the turn
 * recorded data for it, with a separator before each visible part.
 */
export function TurnInspection({ steps }: { steps: Message[] }) {
  const usage = React.useMemo(() => runUsage(steps), [steps]);
  const hasCapabilities = React.useMemo(
    () => turnCapabilities(steps).length > 0,
    [steps],
  );
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
    </>
  );
}
