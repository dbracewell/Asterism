import type { ComparisonColumn, ComparisonTarget, Message } from "@/lib/client";
import { parseSkillCommands } from "./skill-commands";

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

/** The model a column ran on, by its current or recorded name. */
export function columnModelName(column: ComparisonColumn): string {
  return (
    column.model?.display_name ||
    column.model?.name ||
    (column.replies ?? []).at(-1)?.execution?.model.name ||
    "Unavailable model"
  );
}

/** A column's heading: its label (e.g. "Before"/"After") or its model. */
export const columnLabel = (column: ComparisonColumn): string =>
  column.request.comparison_label || columnModelName(column);

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

/** The coach's original draft as sent: leading skill commands apply to both columns. */
export const originalBody = (original: string) => {
  const parsed = parseSkillCommands(original);
  return (parsed.names.length ? parsed.prompt : original).trim();
};

/**
 * US-51.7: the original (column 0, the request's own prompt) and the improved
 * draft on the same model, labelled so the columns read as before and after.
 */
export function beforeAfterTargets(
  { original, modelId }: { original: string; modelId: string },
  improved: string,
): ComparisonTarget[] {
  const before = originalBody(original);
  if (!before)
    throw new Error(
      "The reviewed prompt is empty, so there is nothing to compare.",
    );
  if (before === improved.trim())
    throw new Error("Apply a suggestion first, so the prompts differ.");
  return [
    { model_id: modelId, label: "Before" },
    { model_id: modelId, user_prompt: improved.trim(), label: "After" },
  ];
}
