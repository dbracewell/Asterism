import type { InlineFileReference } from "@/lib/client";

const REFERENCE =
  /!?\[([^\]\n]*)\]\(asterism-file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

/**
 * Copyable text for a message: each file reference becomes its label, or the
 * resolved file name when the label is empty (ADR-0039 §5). Tokens are internal
 * and mean nothing outside this chat.
 */
export function copyableText(
  content: string,
  files: readonly InlineFileReference[] = [],
): string {
  return content.replace(REFERENCE, (_, label: string, fileId: string) => {
    const text = label.trim();
    if (text) return text;
    const file = files.find((entry) => entry.file_id === fileId);
    return file?.available && file.name ? file.name : "file";
  });
}
