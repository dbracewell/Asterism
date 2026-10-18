import "server-only";
import { getFrontendServerConfig } from "@/lib/server-config";
import { bundledThemes } from "../bundled";
import { createThemeRepository } from "./repository";

// No catalog cache: each request observes files committed before its read.
export function getThemeRepository() {
  return createThemeRepository(
    getFrontendServerConfig().storageRoot,
    bundledThemes,
  );
}
export async function getAllThemes() {
  return getThemeRepository().list();
}
export async function readCatalogTheme(id: string) {
  return getThemeRepository().read(id);
}
