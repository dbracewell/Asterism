import { EmptyState } from "@/components/empty-state";

/**
 * Admin Settings → Memory until memory is used in chats (US-93.5). The working
 * policy pane (memory-policy-settings) replaces it then; admins can already set
 * the policy through the API.
 */
export const MemoryPlannedSettings = () => (
  <EmptyState
    className="rounded-surface border p-8"
    title="Memory"
    description="Memory settings, for everyone or for selected groups, are planned for a future release."
  />
);
