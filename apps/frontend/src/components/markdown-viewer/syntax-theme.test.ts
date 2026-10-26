import { describe, expect, it } from "vitest";
import { syntaxTheme } from "./syntax-theme";

describe("syntax palette selection", () => {
  it("keeps light and dark code backgrounds distinct for arbitrary custom IDs", () => {
    expect(syntaxTheme("custom-palette", "light").hljs.background).not.toBe(
      syntaxTheme("custom-palette", "dark").hljs.background,
    );
  });
  it("gives Dracula and One Dark their own syntax families", () => {
    expect(syntaxTheme("dracula", "dark")).not.toEqual(
      syntaxTheme("night-atlas", "dark"),
    );
    expect(syntaxTheme("one_dark", "dark")).not.toEqual(
      syntaxTheme("night-atlas", "dark"),
    );
    expect(syntaxTheme("flowers", "light")).toEqual(
      syntaxTheme("catppuccin-latte-mauve", "light"),
    );
  });
  it("puts Atlas code on the theme card surface", () => {
    expect(syntaxTheme("atlas", "light").hljs.background).toBe("var(--card)");
    expect(syntaxTheme("night-atlas", "dark").hljs.background).toBe(
      "var(--card)",
    );
    expect(syntaxTheme("night-atlas", "dark")).not.toEqual(
      syntaxTheme("atlas", "light"),
    );
  });
});
