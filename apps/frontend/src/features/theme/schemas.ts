import { z } from "zod";

export const themeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
export const themeColorsSchema = z.strictObject({
  background: hexColor,
  foreground: hexColor,
  card: hexColor,
  "card-foreground": hexColor,
  popover: hexColor,
  "popover-foreground": hexColor,
  primary: hexColor,
  "primary-foreground": hexColor,
  secondary: hexColor,
  "secondary-foreground": hexColor,
  muted: hexColor,
  "muted-foreground": hexColor,
  accent: hexColor,
  "accent-foreground": hexColor,
  destructive: hexColor,
  border: hexColor,
  input: hexColor,
  ring: hexColor,
  sidebar: hexColor,
  "sidebar-foreground": hexColor,
  "sidebar-primary": hexColor,
  "sidebar-primary-foreground": hexColor,
  "sidebar-accent": hexColor,
  "sidebar-accent-foreground": hexColor,
  "sidebar-border": hexColor,
  "sidebar-ring": hexColor,
});
export const themeDataSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\x00-\x1f\x7f]+$/),
  type: z.enum(["dark", "light"]),
  colors: themeColorsSchema,
});
export const themeSaveSchema = themeDataSchema.extend({
  filename: z.union([themeIdSchema, z.literal(""), z.null()]).optional(),
});
