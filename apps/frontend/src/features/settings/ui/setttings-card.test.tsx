import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Types } from "@/features/settings/types";
import { SettingsCard } from "./setttings-card";

const mocks = vi.hoisted(() => ({
  paneRendered: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: mocks.replace }),
}));

const settings: Types = [
  {
    type: "section",
    label: "First",
    value: "first",
    isDefault: true,
    icon: null,
    settingsPane: <Pane name="first" />,
  },
  {
    type: "section",
    label: "Second",
    value: "second",
    icon: null,
    settingsPane: <Pane name="second" />,
  },
];

function Pane({ name }: { name: string }): ReactNode {
  mocks.paneRendered(name);
  return <div data-testid={`${name}-pane`}>{name}</div>;
}

describe("SettingsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts only the default pane", () => {
    render(<SettingsCard name="admin" settings={settings} />);

    expect(screen.getByTestId("first-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("second-pane")).not.toBeInTheDocument();
    expect(mocks.paneRendered).toHaveBeenCalledTimes(1);
    expect(mocks.paneRendered).toHaveBeenCalledWith("first");
  });

  it("mounts the selected pane and updates the deep-link URL", async () => {
    const user = userEvent.setup();
    render(<SettingsCard name="admin" settings={settings} />);

    await user.click(screen.getByRole("tab", { name: "Second" }));

    expect(screen.queryByTestId("first-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("second-pane")).toBeInTheDocument();
    expect(mocks.paneRendered).toHaveBeenCalledTimes(2);
    expect(mocks.paneRendered).toHaveBeenLastCalledWith("second");
    expect(mocks.replace).toHaveBeenCalledWith(
      "/settings?t=admin&setting=second",
    );
  });

  it("uses a requested deep-linked pane without mounting the default", () => {
    render(
      <SettingsCard name="admin" settings={settings} defaultTab="second" />,
    );

    expect(screen.queryByTestId("first-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("second-pane")).toBeInTheDocument();
  });

  it("follows deep-link changes from browser navigation", () => {
    const { rerender } = render(
      <SettingsCard name="admin" settings={settings} defaultTab="first" />,
    );

    rerender(
      <SettingsCard name="admin" settings={settings} defaultTab="second" />,
    );

    expect(screen.queryByTestId("first-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("second-pane")).toBeInTheDocument();
  });
});
