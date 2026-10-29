import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import atlas from "@/features/theme/bundled/atlas.json";
import dracula from "@/features/theme/bundled/dracula.json";
import nightAtlas from "@/features/theme/bundled/night-atlas.json";
import type { Theme } from "@/features/theme/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeGallery, themeEditorHref } from "./theme-gallery";

const themes = {
  atlas: { ...atlas, filename: "atlas" },
  dracula: { ...dracula, filename: "dracula" },
  "night-atlas": { ...nightAtlas, filename: "night-atlas" },
} as Record<string, Theme>;
const summary = (filename: string) => ({
  name: themes[filename].name,
  filename,
  type: themes[filename].type,
});

vi.mock("@/features/theme/components/theme-context", () => ({
  useTheme: () => ({
    lightThemes: [summary("atlas")],
    darkThemes: [summary("dracula"), summary("night-atlas")],
    getTheme: (filename: string) => themes[filename],
  }),
}));

function show(props: Partial<Parameters<typeof ThemeGallery>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <ThemeGallery currentTheme="atlas" onChange={onChange} {...props} />
    </TooltipProvider>,
  );
  return { onChange };
}

describe("ThemeGallery", () => {
  it("renders one named radio per theme with a preview in that theme's variables", () => {
    show();
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: atlas.name })).toBeChecked();
    expect(screen.getByRole("radio", { name: dracula.name })).not.toBeChecked();
    expect(
      screen.getByRole("group", { name: "Dark themes" }),
    ).toBeInTheDocument();

    const previews = screen.getAllByTestId("theme-preview-tile");
    expect(previews).toHaveLength(3);
    const draculaPreview = previews[1];
    expect(draculaPreview).toHaveAttribute("aria-hidden", "true");
    expect(draculaPreview).toHaveClass("dark");
    expect(draculaPreview.style.getPropertyValue("--background")).toBe(
      dracula.colors.background,
    );
    expect(draculaPreview.style.getPropertyValue("--primary")).toBe(
      dracula.colors.primary,
    );
  });

  it("applies a theme when its tile is clicked", () => {
    const { onChange } = show();
    fireEvent.click(screen.getByText(dracula.name));
    expect(onChange).toHaveBeenCalledWith("dracula");
  });

  it("is one tab stop and moves selection with arrow keys", async () => {
    const user = userEvent.setup();
    const { onChange } = show();
    await user.tab();
    expect(screen.getByRole("radio", { name: atlas.name })).toHaveFocus();
    // Radix checks a radio when focus arrives while an arrow key is held.
    await user.keyboard("{ArrowRight>}");
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: dracula.name })).toHaveFocus(),
    );
    expect(onChange).toHaveBeenLastCalledWith("dracula");
    await user.keyboard("{/ArrowRight}{ArrowDown>}");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("night-atlas"),
    );
    await user.keyboard("{/ArrowDown}");
  });

  it("offers the editor only to admins, on the selected tile", () => {
    show({ currentTheme: "dracula", canEdit: true });
    const links = screen.getAllByRole("link", { name: /^Edit .* theme$/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(`Edit ${dracula.name} theme`);
    expect(links[0]).toHaveAttribute("href", themeEditorHref("dracula"));
    expect(themeEditorHref("dracula")).toBe(
      "/settings?t=admin&setting=theme_editor&theme=dracula",
    );
  });

  it("hides the editor link from non-admins", () => {
    show({ canEdit: false });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
