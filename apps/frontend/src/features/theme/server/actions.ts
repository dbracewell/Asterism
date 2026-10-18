"use server";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { themeIdSchema, themeSaveSchema } from "../schemas";
import { requireThemeAdmin } from "./authorization";
import { getAllThemes, readCatalogTheme, themePath } from "./catalog";

export async function loadTheme(id: string) {
  await requireThemeAdmin();
  return readCatalogTheme(themeIdSchema.parse(id));
}

export async function saveTheme(input: unknown) {
  await requireThemeAdmin();
  const { filename, ...theme } = themeSaveSchema.parse(input);
  const id = filename || randomUUID();
  if (filename) {
    await readCatalogTheme(id);
  } else {
    const themes = await getAllThemes();
    if (Object.values(themes).some((entry) => entry.name === theme.name)) {
      throw new Error("Theme name already exists");
    }
  }
  const { target } = await themePath(id);
  await writeFile(target, JSON.stringify(theme, null, 2), {
    flag: filename ? "w" : "wx",
  });
  revalidatePath("/");
}
