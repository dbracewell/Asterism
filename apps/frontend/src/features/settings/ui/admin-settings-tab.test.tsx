import { Tabs } from "@/components/ui/tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AdminSettingsTab } from "./admin-settings-tab";

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appSettingsGetOptions: () => ({
    queryKey: ["appSettingsGet"],
    queryFn: () => Promise.reject(new Error("unavailable")),
  }),
}));

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<AdminSettingsTab />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Tabs value="admin">{children}</Tabs>
      </QueryClientProvider>
    ),
  });
}

describe("AdminSettingsTab", () => {
  it("shows an accessible error for its selected pane", async () => {
    renderTab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Admin settings could not be loaded.",
    );
  });
});
