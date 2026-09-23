import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPageView } from "./settings-page-view";

const mocks = vi.hoisted(() => ({
  adminSettingsGet: vi.fn(),
  replace: vi.fn(),
  role: "admin",
  search: "",
}));

vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ role: mocks.role }),
}));

vi.mock("@/features/settings/ui/admin-settings-tab", () => ({
  AdminSettingsTab: () => <div data-testid="admin-settings" />,
}));

vi.mock("@/features/settings/ui/user-settings-tab", () => ({
  UserSettingsTab: () => <div data-testid="user-settings" />,
}));

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appProviderSettingsGetOptions: mocks.adminSettingsGet,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<SettingsPageView />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

describe("SettingsPageView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminSettingsGet.mockReturnValue({
      queryKey: ["appProviderSettingsGet"],
      queryFn: vi.fn().mockResolvedValue({}),
    });
    mocks.role = "admin";
    mocks.search = "";
  });

  it("does not mount admin settings on a User Settings visit", () => {
    renderPage();

    expect(screen.getByTestId("user-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-settings")).not.toBeInTheDocument();
  });

  it("mounts only admin settings for an admin deep link", () => {
    mocks.search = "t=admin&setting=providers";
    renderPage();

    expect(screen.getByTestId("admin-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("user-settings")).not.toBeInTheDocument();
  });

  it("navigates to admin settings when its trigger is selected", async () => {
    renderPage();

    await userEvent.setup().click(
      screen.getByRole("tab", { name: "Admin Settings" }),
    );

    expect(mocks.replace).toHaveBeenCalledWith("/settings?t=admin");
  });

  it("prefetches admin settings when its trigger receives focus", () => {
    renderPage();

    fireEvent.focus(screen.getByRole("tab", { name: "Admin Settings" }));

    expect(mocks.adminSettingsGet).toHaveBeenCalledOnce();
  });
});
