export const THEME_NAME_COOKIE = "asterism-custom-theme-name";
export const FONT_SIZE_COOKIE = "asterism-font-size";
export const DEFAULT_THEME_NAME = "atlas";
export const DEFAULT_FONT_SIZE = "16px";

/** Atlas shape values; themes that omit a shape field inherit these. */
export const ATLAS_SHAPE = {
  radius: 0.45,
  shadow: "soft",
  density: "comfortable",
} as const;
/** Corner radius bounds in rem. */
export const THEME_RADIUS_MIN = 0;
export const THEME_RADIUS_MAX = 1.25;
