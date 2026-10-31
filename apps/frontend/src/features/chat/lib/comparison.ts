import type { ComparisonColumn, Message } from "@/lib/client";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 3;

/** Packet tag identifying the comparison column a streamed run answers. */
export type ComparisonTag = { id: string; column_id: string };

export const parseComparisonTag = (raw: unknown): ComparisonTag | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const { id, column_id } = raw as Record<string, unknown>;
  return typeof id === "string" && typeof column_id === "string"
    ? { id, column_id }
    : undefined;
};

export type TranscriptItem =
  | { kind: "message"; message: Message; index: number }
  | { kind: "comparison"; comparisonId: string; message: Message };

/**
 * The active branch with each comparison turn folded into one item. The
 * active column's own replies render inside the comparison, so they are
 * skipped here; the turns after them continue the transcript.
 */
export function groupTranscript(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let insideComparison = false;
  messages.forEach((message, index) => {
    if (message.role === "user") {
      insideComparison = !!message.comparison_id;
      items.push(
        message.comparison_id
          ? {
              kind: "comparison",
              comparisonId: message.comparison_id,
              message,
            }
          : { kind: "message", message, index },
      );
      return;
    }
    if (!insideComparison) items.push({ kind: "message", message, index });
  });
  return items;
}

export function columnLabel(column: ComparisonColumn): string {
  return (
    column.model?.display_name ||
    column.model?.name ||
    (column.replies ?? []).at(-1)?.execution?.model.name ||
    "Unavailable model"
  );
}

const count = new Intl.NumberFormat();

export function usageText(column: ComparisonColumn): string | null {
  if (!column.total_tokens && !column.generation_duration_ms) return null;
  const parts = [
    `${count.format(column.input_tokens ?? 0)} in`,
    `${count.format(column.output_tokens ?? 0)} out`,
  ];
  if (column.generation_duration_ms)
    parts.push(`${(column.generation_duration_ms / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

/** The first reply that delegated, whose run graph the column links to. */
export const runGraphReply = (column: ComparisonColumn) =>
  (column.replies ?? []).find((reply) => !!reply.delegations?.length);

/** Chooses the composer's comparison targets: none, or two to three models. */
export function toggleTarget(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  return selected.length >= MAX_COMPARE ? selected : [...selected, id];
}
