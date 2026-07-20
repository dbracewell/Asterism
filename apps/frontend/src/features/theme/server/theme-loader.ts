"use server";

import {
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME_NAME,
  FONT_SIZE_COOKIE,
  THEME_NAME_COOKIE,
  THEME_REFRESH_COOKIE,
} from "@/features/theme/constants";
import { convertToCssVariables } from "@/features/theme/lib/utils";
import { ExtendedTheme } from "@/features/theme/types";
import fs, { readFile } from "fs/promises";
import { cookies } from "next/headers";
import path from "path";
import lightTheme from "../../../../public/themes/light.json";

const globalForData = globalThis as unknown as {
  themes: Record<string, ExtendedTheme> | null;
};

export async function getTheme() {
  const cookieStore = await cookies();
  const themeNameCookie =
    cookieStore.get(THEME_NAME_COOKIE)?.value ?? DEFAULT_THEME_NAME;
  const fontSize =
    cookieStore.get(FONT_SIZE_COOKIE)?.value ?? DEFAULT_FONT_SIZE;

  const shouldRefresh = cookieStore.has(THEME_REFRESH_COOKIE);
  if (shouldRefresh) {
    globalForData.themes = null;
  }

  const allThemes = await getAllThemes();
  const currentTheme = allThemes[themeNameCookie];
  const themeStyles = convertToCssVariables(
    currentTheme.colors,
  ) as React.CSSProperties;
  const mode = currentTheme.type;

  return {
    fontSize,
    currentTheme,
    themeStyles,
    mode,
    allThemes,
  };
}

export async function getAllThemes() {
  if (globalForData.themes) {
    return globalForData.themes;
  }

  const filePath = path.join(process.cwd(), "public", "themes");

  try {
    const files = await fs.readdir(filePath);
    const themes: Record<string, ExtendedTheme> = {};
    for (const file of files) {
      if (!file.toLowerCase().endsWith(".json")) {
        continue;
      }
      const data = JSON.parse(
        await readFile(path.join(filePath, file), "utf-8"),
      );
      console.log(`Loading ${file} theme`);
      const fileName = file.slice(0, -5);
      themes[fileName] = data;
      themes[fileName]["filename"] = fileName;
    }
    globalForData.themes = themes;
    return themes;
  } catch (error: unknown) {
    console.log(error);
    globalForData.themes = {
      light: { ...lightTheme, filename: "light.json", type: "light" },
    };
    return globalForData.themes;
  }
}
