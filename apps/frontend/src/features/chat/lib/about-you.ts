import type { MessageExecution } from "@/lib/client";

/**
 * The About you revision a run was sent with, or null when the text was
 * blank and the run had no profile layer (ADR-0066).
 */
export function aboutRevision(
  execution: MessageExecution | null | undefined,
): number | null {
  const source = execution?.prompt?.sources?.find(
    (item) => item.kind === "profile",
  );
  return source ? source.revision : null;
}

/** "About you (revision N)", for provenance labels. */
export function aboutLabel(revision: number): string {
  return `About you (revision ${revision})`;
}
