import type { QueryKey } from "@tanstack/react-query";

/**
 * What sending a message changes (US-117.2): the chat and chat lists (its new
 * message and ordering), search, the draft it consumed, the context and file
 * scope it adds to, a comparison it starts, and the person's usage. Other
 * queries (settings, models, projects, files) keep their cache instead of the
 * global refresh every mutation gets by default.
 *
 * Partial keys: each matches every variant of that query (any chat, page or
 * filter), as TanStack Query matches object keys partially.
 */
export const MESSAGE_SEND_INVALIDATES: QueryKey[] = [
  "chatSessionGetOne",
  "chatSessionGetMany",
  "chatSearch",
  "chatDraftGetOne",
  "chatContextLayersGet",
  "chatComparisonGetOne",
  "chatFileGetScope",
  "usageGetMine",
].map((id) => [{ _id: id }]);
