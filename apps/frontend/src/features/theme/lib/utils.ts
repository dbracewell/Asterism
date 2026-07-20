import { CssVariableTheme, ThemeColors } from "@/features/theme/types";

export function convertToCssVariables(colors: ThemeColors): CssVariableTheme {
  const cssVariables = {} as Record<string, string>;

  for (const [key, value] of Object.entries(colors)) {
    cssVariables[`--${key}`] = value;
  }

  return cssVariables as CssVariableTheme;
}
