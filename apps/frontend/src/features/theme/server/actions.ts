"use server";
import { getAllThemes } from "@/features/theme/server/theme-loader";
import { Theme } from "@/features/theme/types";
import { readFile, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import path from "path";

const globalForData = globalThis as unknown as {
  themes: Record<string, Theme> | null;
};

export const loadTheme = async (filename: string) => {
  const normed = filename.toLocaleLowerCase().replace(".json", "") + ".json";
  const filePath = path.join(process.cwd(), "public", "themes", normed);
  const data = JSON.parse(await readFile(filePath, "utf-8"));
  const fileName = normed.slice(0, -5);
  return {
    ...data,
    filename: fileName,
  } as Theme;
};

export const saveTheme = async (
  theme: Omit<Theme, "filename"> & { filename?: string | null },
) => {
  const existingTheme = theme.filename && theme.filename !== "";
  const fileName = existingTheme ? theme.filename : crypto.randomUUID();
  const filePath = path.join(
    process.cwd(),
    "public",
    "themes",
    `${fileName?.toLocaleLowerCase()}.json`,
  );

  let allThemes: Record<string, Theme>;
  if (globalForData.themes != null) {
    allThemes = globalForData.themes;
  } else {
    allThemes = await getAllThemes();
  }

  if (!existingTheme) {
    const nameExists = Object.values(allThemes).find(
      (t) => t.name === theme.name,
    );
    if (nameExists) {
      throw Error("Theme name already exists");
    }
  }

  try {
    writeFile(filePath, JSON.stringify(theme, null, 2));
  } catch (error) {
    console.error(error);
  }
  globalForData.themes = null;
  revalidatePath("/");
};
