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
      syntaxTheme("dark", "dark"),
    );
    expect(syntaxTheme("one_dark", "dark")).not.toEqual(
      syntaxTheme("dark", "dark"),
    );
    expect(syntaxTheme("flowers", "light")).toEqual(
      syntaxTheme("catppuccin-latte-mauve", "light"),
    );
  });
});
