import "server-only";

import {
  allowedFontSize,
  DEFAULT_THEME_NAME,
  FONT_SIZE_COOKIE,
  THEME_NAME_COOKIE,
} from "@/features/theme/constants";
import { themeToCssVariables } from "@/features/theme/lib/utils";
import { getAllThemes } from "./catalog";
import { cookies } from "next/headers";

export async function getTheme() {
  const cookieStore = await cookies();
  let themeNameCookie =
    cookieStore.get(THEME_NAME_COOKIE)?.value ?? DEFAULT_THEME_NAME;
  // Rendered into the page's style: only the offered sizes (US-116.2).
  const fontSize = allowedFontSize(cookieStore.get(FONT_SIZE_COOKIE)?.value);

  const allThemes = await getAllThemes();
  if (!Object.hasOwn(allThemes, themeNameCookie)) {
    themeNameCookie = DEFAULT_THEME_NAME;
  }
  const currentTheme = allThemes[themeNameCookie];
  const themeStyles = themeToCssVariables(currentTheme) as React.CSSProperties;
  const mode = currentTheme.type;

  return {
    fontSize,
    currentTheme,
    themeStyles,
    mode,
    allThemes,
  };
}
