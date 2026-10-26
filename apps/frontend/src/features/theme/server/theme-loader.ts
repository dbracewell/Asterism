import "server-only";

import {
  DEFAULT_FONT_SIZE,
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
  const fontSize =
    cookieStore.get(FONT_SIZE_COOKIE)?.value ?? DEFAULT_FONT_SIZE;

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
