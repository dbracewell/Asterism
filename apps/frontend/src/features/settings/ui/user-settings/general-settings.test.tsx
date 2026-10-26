import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneralSettings } from "./general-settings";

const { updateSetting } = vi.hoisted(() => ({ updateSetting: vi.fn() }));
vi.mock("@/features/settings/hooks/use-update-user-settings", () => ({
  useUpdateUserSettings: () => ({
    updateSetting,
    isUpdatingUserSetting: false,
  }),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { theme: "atlas", font_size: "16px" } }),
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({
    setTheme: vi.fn(),
    setFontSize: vi.fn(),
    lightThemes: [{ filename: "atlas", name: "Atlas" }],
    darkThemes: [],
  }),
}));
describe("General settings labels", () => {
  it("names real selectors and makes the thinking label toggle its checkbox", () => {
    render(<GeneralSettings />);
    expect(screen.getByRole("combobox", { name: "Theme" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Font Size" })).toBeEnabled();
    expect(
      screen.getByRole("combobox", { name: "Default Model" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Show Thinking" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByText("Show Thinking"));
    expect(updateSetting).toHaveBeenCalledWith("show_thinking", true, false);
  });
});
