import { client } from "@/lib/api";
import { appSettingsGetOptions } from "@/lib/client/@tanstack/react-query.gen";

export const ADMIN_SETTINGS_STALE_TIME_MS = 30_000;

export const adminSettingsQueryOptions = () => ({
  ...appSettingsGetOptions({ client }),
  staleTime: ADMIN_SETTINGS_STALE_TIME_MS,
});
