export const THEME_NAME_COOKIE = "asterism-custom-theme-name";
export const FONT_SIZE_COOKIE = "asterism-font-size";
export const DEFAULT_THEME_NAME = "atlas";
export const DEFAULT_FONT_SIZE = "16px";
/** The sizes Settings offers; anything else in a cookie or setting is ignored (US-116.2). */
export const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px"] as const;

export function allowedFontSize(value: string | null | undefined): string {
  return (FONT_SIZES as readonly string[]).includes(value ?? "")
    ? value!
    : DEFAULT_FONT_SIZE;
}

/** Atlas shape values; themes that omit a shape field inherit these. */
export const ATLAS_SHAPE = {
  radius: 0.45,
  shadow: "soft",
  density: "comfortable",
} as const;
/** Corner radius bounds in rem. */
export const THEME_RADIUS_MIN = 0;
export const THEME_RADIUS_MAX = 1.25;
