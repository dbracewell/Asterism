import { copyableText } from "@/components/markdown-viewer/copy-text";
import type { Message } from "@/lib/client";

export const EXERCISE_LABEL =
  "Exercise: this answer contains one deliberate error.";

/**
 * A message's copyable text. Exercise answers keep their label wherever their
 * text goes (US-55.4), so a copied exercise is never mistaken for an answer.
 */
export function messageCopyText(
  message: Pick<Message, "content" | "inline_files" | "exercise">,
): string {
  const text = copyableText(message.content, message.inline_files);
  return message.exercise ? `[${EXERCISE_LABEL}]\n\n${text}` : text;
}
