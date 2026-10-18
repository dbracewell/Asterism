"use server";
import { revalidatePath } from "next/cache";
import { themeIdSchema } from "../schemas";
import type { ThemeSaveResult } from "../results";
import { requireThemeAdmin } from "./authorization";
import { getThemeRepository, readCatalogTheme } from "./catalog";
import { ThemeRepositoryError } from "./repository";

export async function loadTheme(id: string) {
  await requireThemeAdmin();
  return readCatalogTheme(themeIdSchema.parse(id));
}

export async function saveTheme(input: unknown): Promise<ThemeSaveResult> {
  await requireThemeAdmin();
  let theme;
  try {
    theme = await getThemeRepository().save(input);
  } catch (error) {
    if (error instanceof ThemeRepositoryError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    return {
      ok: false,
      error: {
        code: "STORAGE_ERROR",
        message:
          "Theme could not be saved. Your edits are still here; try again.",
      },
    };
  }
  // Persistence has committed. A refresh error must not misreport a failed write.
  try {
    revalidatePath("/", "layout");
  } catch {
    console.error("Theme saved, but layout revalidation failed");
  }
  return { ok: true, theme };
}
