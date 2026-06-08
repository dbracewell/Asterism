export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  popover: string;
  "popover-foreground": string;
  primary: string;
  "primary-foreground": string;
  secondary: string;
  "secondary-foreground": string;
  muted: string;
  "muted-foreground": string;
  accent: string;
  "accent-foreground": string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  "chart-1": string;
  "chart-2": string;
  "chart-3": string;
  "chart-4": string;
  "chart-5": string;
  sidebar: string;
  "sidebar-foreground": string;
  "sidebar-primary": string;
  "sidebar-primary-foreground": string;
  "sidebar-accent": string;
  "sidebar-accent-foreground": string;
  "sidebar-border": string;
  "sidebar-ring": string;
}

export type CssVariableTheme = {
  [K in keyof ThemeColors as `--${K}`]: string;
};

export function convertToCssVariables(colors: ThemeColors): CssVariableTheme {
  const cssVariables = {} as Record<string, string>;

  for (const [key, value] of Object.entries(colors)) {
    cssVariables[`--${key}`] = value;
  }

  return cssVariables as CssVariableTheme;
}

export type Theme = {
  name: string;
  filename: string;
};
