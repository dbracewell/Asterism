import type { CSSProperties } from "react";
import a11yDark from "react-syntax-highlighter/dist/esm/styles/hljs/a11y-dark";
import a11yLight from "react-syntax-highlighter/dist/esm/styles/hljs/a11y-light";
import atomOneDark from "react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark";
import atomOneLight from "react-syntax-highlighter/dist/esm/styles/hljs/atom-one-light";
import dracula from "react-syntax-highlighter/dist/esm/styles/hljs/dracula";
import vs from "react-syntax-highlighter/dist/esm/styles/hljs/vs";
import vs2015 from "react-syntax-highlighter/dist/esm/styles/hljs/vs2015";

// Related families use established syntax palettes, not approximated token colors.
// Custom theme IDs fall back to their declared light/dark type.
// Atlas keeps the a11y token colors (AA on both) but sits on the theme card surface.
export function syntaxTheme(
  theme: string | undefined,
  type: "light" | "dark",
): Record<string, CSSProperties> {
  if (theme === "atlas" || theme === "night-atlas") {
    const base = theme === "atlas" ? a11yLight : a11yDark;
    return { ...base, hljs: { ...base.hljs, background: "var(--card)" } };
  }
  if (theme === "dracula") return dracula;
  if (theme === "one_dark") return atomOneDark;
  if (theme === "catppuccin-latte-mauve" || theme === "flowers")
    return atomOneLight;
  return type === "dark" ? vs2015 : vs;
}
