import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GeneralSettings } from "./general-settings";

const { updateSetting, setTheme, role } = vi.hoisted(() => ({
  updateSetting: vi.fn(),
  setTheme: vi.fn(),
  role: { current: "user" },
}));
vi.mock("@/features/settings/hooks/use-update-user-settings", () => ({
  useUpdateUserSettings: () => ({
    updateSetting,
    isUpdatingUserSetting: false,
  }),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({
    role: role.current,
    settings: { theme: "atlas", font_size: "16px" },
  }),
}));
vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({
    setTheme,
    setFontSize: vi.fn(),
    lightThemes: [{ filename: "atlas", name: "Atlas" }],
    darkThemes: [{ filename: "dracula", name: "Dracula" }],
    getTheme: () => undefined,
  }),
}));
describe("General settings labels", () => {
  it("names real selectors and makes the thinking label toggle its checkbox", () => {
    render(<GeneralSettings />, { wrapper: TooltipProvider });
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeEnabled();
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

  it("saves and applies a theme picked from the gallery", () => {
    render(<GeneralSettings />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("radio", { name: "Dracula" }));
    expect(updateSetting).toHaveBeenCalledWith("theme", "dracula", false);
    expect(setTheme).toHaveBeenCalledWith("dracula");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("lets admins open the editor from the selected tile", () => {
    role.current = "admin";
    render(<GeneralSettings />, { wrapper: TooltipProvider });
    expect(
      screen.getByRole("link", { name: "Edit Atlas theme" }),
    ).toHaveAttribute(
      "href",
      "/settings?t=admin&setting=theme_editor&theme=atlas",
    );
    role.current = "user";
  });
});
