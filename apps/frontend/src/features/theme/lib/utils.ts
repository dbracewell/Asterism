import { ATLAS_SHAPE } from "@/features/theme/constants";
import { CssVariableTheme, Theme } from "@/features/theme/types";

const SPACING = { comfortable: "0.25rem", compact: "0.225rem" } as const;

/** Resolves a theme's shape against Atlas so every theme sets every variable. */
export function resolveThemeShape(
  theme: Pick<Theme, "radius" | "shadow" | "density">,
) {
  return {
    radius: theme.radius ?? ATLAS_SHAPE.radius,
    shadow: theme.shadow ?? ATLAS_SHAPE.shadow,
    density: theme.density ?? ATLAS_SHAPE.density,
  };
}

// Inherited custom properties, so a nested element can preview another theme.
export function themeToCssVariables(
  theme: Pick<Theme, "colors" | "radius" | "shadow" | "density">,
): CssVariableTheme {
  const cssVariables = {} as Record<string, string>;
  for (const [key, value] of Object.entries(theme.colors)) {
    cssVariables[`--${key}`] = value;
  }
  const shape = resolveThemeShape(theme);
  cssVariables["--radius"] = `${shape.radius}rem`;
  cssVariables["--elevation"] = shape.shadow === "flat" ? "0" : "1";
  cssVariables["--spacing"] = SPACING[shape.density];
  return cssVariables as CssVariableTheme;
}
