import { EmptyState } from "@/components/empty-state";

export const UserPermissionsSettings = () => (
  <EmptyState
    className="rounded-surface border p-8"
    title="Users"
    description="Admin and user access checks are already enforced; user management screens and permission controls are planned for a future release."
  />
);
