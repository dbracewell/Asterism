import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  nextId: 0,
  rendered: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    const id = mocks.nextId++;
    return function MockDynamicPane() {
      mocks.rendered(id);
      return <div>lazy pane {id}</div>;
    };
  },
}));

import { getLazyAdminSettingsSections } from "./lazy-sections";

describe("getLazyAdminSettingsSections", () => {
  beforeEach(() => {
    mocks.rendered.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders only the selected lazy pane implementation", () => {
    const sections = getLazyAdminSettingsSections();
    const providers = sections.find(
      (section) => section.type === "section" && section.value === "providers",
    );

    expect(providers?.type).toBe("section");
    if (providers?.type !== "section")
      throw new Error("Providers pane missing");

    render(providers.settingsPane);

    expect(screen.getByText("lazy pane 0")).toBeInTheDocument();
    expect(mocks.rendered).toHaveBeenCalledOnce();
    expect(mocks.rendered).toHaveBeenCalledWith(0);
  });

  it("marks exactly the five unfinished panes as Planned and keeps available panes discoverable", () => {
    const sections = getLazyAdminSettingsSections().filter(
      (section) => section.type === "section",
    );
    expect(
      sections
        .filter((section) => section.badge === "Planned")
        .map((section) => section.label),
    ).toEqual([
      "Groups",
      "Users",
      "Image Generation",
      "Code Execution",
      "Export",
    ]);
    expect(
      sections
        .filter((section) => !section.badge)
        .map((section) => section.label),
    ).toEqual([
      "Providers",
      "Theme Editor",
      "Tools",
      "Skills",
      "Image Captioning",
    ]);
    expect(sections.every((section) => !section.disabled)).toBe(true);
  });
});
