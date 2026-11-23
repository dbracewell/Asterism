import type { Memory, MemoryCategory } from "@/lib/client";
import {
  memoryAvailabilityQueryKey,
  memoryGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";

/** The server's bound on one memory (ADR-0078). */
export const MEMORY_MAX_CHARS = 2000;

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  learning: "How you learn",
  accessibility: "Accessibility",
  background: "Background",
  other: "Other",
};

export const CATEGORY_ORDER: MemoryCategory[] = [
  "learning",
  "accessibility",
  "background",
  "other",
];

/** Every memory list, and one-memory lookups; partial keys match all their variants. */
export function memoryInvalidates() {
  return [
    memoryGetManyQueryKey(),
    [{ _id: "memoryGetOne" }],
    memoryAvailabilityQueryKey(),
  ];
}

/** Where a memory is managed: Your Asterism for yours, project settings for a project's. */
export function memoryHref(memory: Pick<Memory, "id" | "kind" | "project_id">) {
  if (memory.kind === "project" && memory.project_id) {
    return `/projects/${memory.project_id}?tab=settings&memory=${memory.id}`;
  }
  return `/settings?t=user&setting=your-asterism&memory=${memory.id}`;
}

/** Where a memory came from, in a few words. */
export function sourceLabel(memory: Memory): string {
  if (memory.saved_by === "person") return "Added by you";
  return memory.source.chat_deleted
    ? "Saved from a chat (chat deleted)"
    : "Saved from a chat";
}
