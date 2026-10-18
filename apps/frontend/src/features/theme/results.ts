import type { Theme } from "./types";

export type ThemeErrorCode =
  | "INVALID_THEME"
  | "NOT_FOUND"
  | "DUPLICATE_NAME"
  | "STORAGE_ERROR";
export type ThemeSaveResult =
  | { ok: true; theme: Theme }
  | { ok: false; error: { code: ThemeErrorCode; message: string } };
