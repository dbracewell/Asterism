import { Tabs } from "@/components/ui/tabs";
import { render, screen } from "@testing-library/react";
import { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AdminSettingsTab } from "./admin-settings-tab";

vi.mock("@/features/settings/ui/admin-settings/lazy-sections", () => ({
  getLazyAdminSettingsSections: () => [
    {
      type: "section",
      label: "Providers",
      value: "providers",
      isDefault: true,
      settingsPane: <p>Providers pane</p>,
    },
  ],
}));

vi.mock("@/features/settings/ui/setttings-card", () => ({
  SettingsCard: ({ settings }: { settings: { settingsPane: ReactNode }[] }) =>
    settings[0]?.settingsPane,
}));

function renderTab() {
  return render(<AdminSettingsTab />, {
    wrapper: ({ children }) => <Tabs value="admin">{children}</Tabs>,
  });
}

describe("AdminSettingsTab", () => {
  it("renders the selected pane without an aggregate settings request", () => {
    renderTab();

    expect(screen.getByText("Providers pane")).toBeInTheDocument();
  });
});
