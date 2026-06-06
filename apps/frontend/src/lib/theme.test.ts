import { describe, expect, it } from "vitest";

import { convertToCssVariables, type ThemeColors } from "@/lib/theme";

describe("convertToCssVariables", () => {
  it("converts theme color keys to CSS variables", () => {
    const colors: ThemeColors = {
      background: "#fff",
      foreground: "#000",
      card: "#fff",
      "card-foreground": "#000",
      popover: "#fff",
      "popover-foreground": "#000",
      primary: "#111",
      "primary-foreground": "#eee",
      secondary: "#222",
      "secondary-foreground": "#ddd",
      muted: "#333",
      "muted-foreground": "#ccc",
      accent: "#444",
      "accent-foreground": "#bbb",
      destructive: "#f00",
      border: "#999",
      input: "#888",
      ring: "#777",
      "chart-1": "#1",
      "chart-2": "#2",
      "chart-3": "#3",
      "chart-4": "#4",
      "chart-5": "#5",
      sidebar: "#666",
      "sidebar-foreground": "#555",
      "sidebar-primary": "#444",
      "sidebar-primary-foreground": "#333",
      "sidebar-accent": "#222",
      "sidebar-accent-foreground": "#111",
      "sidebar-border": "#aaa",
      "sidebar-ring": "#bbb",
    };

    const vars = convertToCssVariables(colors);

    expect(vars["--background"]).toBe("#fff");
    expect(vars["--primary"]).toBe("#111");
    expect(vars["--sidebar-ring"]).toBe("#bbb");
  });
});
