import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_SETTINGS_STALE_TIME_MS,
  adminSettingsQueryOptions,
} from "./admin-settings-query";

describe("adminSettingsQueryOptions", () => {
  it("reuses a completed prefetch during immediate navigation", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryFn = vi.fn().mockResolvedValue({});
    const options = { ...adminSettingsQueryOptions(), queryFn };

    await queryClient.prefetchQuery(options);
    await queryClient.fetchQuery(options);

    expect(options.staleTime).toBe(ADMIN_SETTINGS_STALE_TIME_MS);
    expect(queryFn).toHaveBeenCalledOnce();
  });
});
