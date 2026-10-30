import type { User } from "@/features/auth/types";

/**
 * The provider step applies only to an administrator on an instance with no
 * active models; everyone else continues straight to the app.
 */
export function needsProviderSetup(user: Pick<User, "role" | "settings">) {
  return user.role === "admin" && (user.settings.models ?? []).length === 0;
}
