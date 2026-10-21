import type { FileKnowledgeArtifact } from "@/lib/client";

/**
 * The kind of one derived output of a source file.
 *
 * The knowledge artifact reports its outputs as a map keyed by kind, so the
 * kind is the identity of an output.
 */
export type ExtractionKind = "text_extraction" | "embedding" | "captioning";

type ExtractionMap = NonNullable<FileKnowledgeArtifact["extractions"]>;
type ExtractionValue = ExtractionMap[string];

/** One derived output, narrowed to the kind that was asked for. */
export type ExtractionOf<K extends ExtractionKind> = Extract<
  ExtractionValue,
  { kind: K }
>;

/**
 * Read one derived output of a knowledge artifact.
 *
 * The artifact reports a map of extractions whose values are a union
 * discriminated by kind, so reading one output's kind-specific payload needs
 * a narrowing step. This helper performs it.
 *
 * @param extractions The artifact's extraction map.
 * @param kind The kind of output to read.
 * @returns The output, or `undefined` when the artifact does not have it.
 */
export function extractionOf<K extends ExtractionKind>(
  extractions: FileKnowledgeArtifact["extractions"],
  kind: K,
): ExtractionOf<K> | undefined {
  const found = extractions?.[kind];
  return found?.kind === kind ? (found as ExtractionOf<K>) : undefined;
}

/**
 * Read the status of one derived output.
 *
 * @param extractions The artifact's extraction map.
 * @param kind The kind of output to read.
 * @returns The output's status, or `"none"` when the artifact does not have
 *   that output.
 */
export function extractionStatus(
  extractions: FileKnowledgeArtifact["extractions"],
  kind: ExtractionKind,
): string {
  return extractionOf(extractions, kind)?.status ?? "none";
}

/**
 * Whether any derived output is still being produced.
 *
 * @param artifact The artifact to inspect.
 * @returns True when an output is pending or running.
 */
export function hasActiveExtraction(
  artifact?: Pick<FileKnowledgeArtifact, "status" | "extractions"> | null,
): boolean {
  if (!artifact) return false;
  if (artifact.status === "pending" || artifact.status === "running") return true;
  return Object.values(artifact.extractions ?? {}).some(
    (extraction) =>
      extraction.status === "pending" || extraction.status === "running",
  );
}
