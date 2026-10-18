import "server-only";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { themeSaveSchema, themeIdSchema } from "../schemas";
import type { Theme } from "../types";

export class ThemeNotFoundError extends Error {}

// IDs are opaque catalog keys, never caller-supplied paths.
export async function themePath(id: string) {
  themeIdSchema.parse(id);
  const directory = path.join(process.cwd(), "public", "themes");
  const target = path.resolve(directory, `${id}.json`);
  if (path.dirname(target) !== directory) throw new Error("Invalid theme path");
  const root = await realpath(directory);
  return { root, target };
}

export async function readCatalogTheme(id: string): Promise<Theme> {
  const { root, target } = await themePath(id);
  let resolved: string;
  try {
    resolved = await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ThemeNotFoundError("Unknown theme");
    }
    throw error;
  }
  if (
    path.dirname(resolved) !== root ||
    resolved !== path.join(root, `${id}.json`)
  ) {
    throw new ThemeNotFoundError("Unknown theme");
  }
  const data = themeSaveSchema.parse(
    // Keep the validated read statically scoped for Next.js output tracing.
    JSON.parse(
      await readFile(
        path.join(process.cwd(), "public", "themes", `${id}.json`),
        "utf8",
      ),
    ),
  );
  return { ...data, filename: id };
}

export async function getAllThemes(): Promise<Record<string, Theme>> {
  const root = path.join(process.cwd(), "public", "themes");
  const themes: Record<string, Theme> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const id = entry.name.slice(0, -5);
    if (!themeIdSchema.safeParse(id).success) continue;
    themes[id] = await readCatalogTheme(id);
  }
  return themes;
}
