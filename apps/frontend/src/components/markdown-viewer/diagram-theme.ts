import { contrastRatio } from "@/features/theme/contrast";
import type { ThemeColors } from "@/features/theme/types";
import { MERMAID_FONT_FAMILY } from "./policy";

/** What a diagram is drawn with; `key` names it in the render cache. */
export type DiagramTheme = {
  key: string;
  dark: boolean;
  /** Mermaid `base` theme variables from the app palette, when there is one. */
  variables?: Record<string, string | boolean>;
};

const CHARTS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;

// The text that reads best on every chart color: chart colors have no paired
// foreground, so pie labels take whichever of the two page colors has the
// higher worst-case contrast.
function chartLabel(colors: ThemeColors): string {
  const worst = (text: string) =>
    Math.min(...CHARTS.map((chart) => contrastRatio(text, colors[chart])));
  return worst(colors.foreground) >= worst(colors.background)
    ? colors.foreground
    : colors.background;
}

/**
 * Mermaid theme variables from the app palette. Every text color sits on the
 * surface it is paired with in `themeTextPairs`, so the palette contrast
 * checks cover diagrams too: nodes and actors on `secondary`, notes, clusters
 * and labels on `muted`, edge labels and titles on `card`.
 */
export function diagramThemeVariables(
  colors: ThemeColors,
  dark: boolean,
): Record<string, string | boolean> {
  const label = chartLabel(colors);
  return {
    darkMode: dark,
    fontFamily: MERMAID_FONT_FAMILY,
    // Mermaid's default drop-shadow is light grey and glows on dark palettes.
    dropShadow: "none",
    background: colors.card,
    textColor: colors["card-foreground"],
    titleColor: colors["card-foreground"],
    lineColor: colors["muted-foreground"],
    edgeLabelBackground: colors.card,

    primaryColor: colors.secondary,
    primaryTextColor: colors["secondary-foreground"],
    primaryBorderColor: colors.primary,
    mainBkg: colors.secondary,
    nodeBorder: colors.primary,
    nodeTextColor: colors["secondary-foreground"],

    secondaryColor: colors.accent,
    secondaryTextColor: colors["accent-foreground"],
    secondaryBorderColor: colors.border,

    tertiaryColor: colors.muted,
    tertiaryTextColor: colors["muted-foreground"],
    tertiaryBorderColor: colors.border,
    clusterBkg: colors.muted,
    clusterBorder: colors.border,

    noteBkgColor: colors.muted,
    noteTextColor: colors["muted-foreground"],
    noteBorderColor: colors.border,

    actorBkg: colors.secondary,
    actorBorder: colors.primary,
    actorTextColor: colors["secondary-foreground"],
    actorLineColor: colors["muted-foreground"],
    signalColor: colors["card-foreground"],
    signalTextColor: colors["card-foreground"],
    labelBoxBkgColor: colors.muted,
    labelBoxBorderColor: colors.border,
    labelTextColor: colors["muted-foreground"],
    loopTextColor: colors["card-foreground"],
    activationBkgColor: colors.accent,
    activationBorderColor: colors.border,
    sequenceNumberColor: colors["primary-foreground"],

    // Mind maps, timelines and journeys cycle through these scales.
    cScale0: colors.primary,
    cScaleLabel0: colors["primary-foreground"],
    cScale1: colors.secondary,
    cScaleLabel1: colors["secondary-foreground"],
    cScale2: colors.accent,
    cScaleLabel2: colors["accent-foreground"],
    cScale3: colors.muted,
    cScaleLabel3: colors["muted-foreground"],

    pie1: colors["chart-1"],
    pie2: colors["chart-2"],
    pie3: colors["chart-3"],
    pie4: colors["chart-4"],
    pie5: colors["chart-5"],
    pieTitleTextColor: colors["card-foreground"],
    pieSectionTextColor: label,
    pieLegendTextColor: colors["card-foreground"],
    pieStrokeColor: colors.card,
    pieOuterStrokeColor: colors.border,

    errorBkgColor: colors.destructive,
    errorTextColor: colors.card,
  };
}

/** The diagram theme for the app's current palette, or mermaid's own light or dark. */
export function diagramTheme(
  name: string | undefined,
  colors: ThemeColors | undefined,
  dark: boolean,
): DiagramTheme {
  if (!colors) return { key: dark ? "mermaid-dark" : "mermaid-light", dark };
  return {
    key: `${name ?? "palette"}:${JSON.stringify(colors)}`,
    dark,
    variables: diagramThemeVariables(colors, dark),
  };
}
