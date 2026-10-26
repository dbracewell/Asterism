import "server-only";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { themeDataSchema, themeIdSchema, themeSaveSchema } from "../schemas";
import type { Theme } from "../types";
import type { ThemeErrorCode } from "../results";

export class ThemeRepositoryError extends Error {
  constructor(
    public readonly code: ThemeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ThemeRepository {
  list(): Promise<Record<string, Theme>>;
  read(id: string): Promise<Theme>;
  save(input: unknown): Promise<Theme>;
}

// Next can load the domain through separate route/action bundles. Share only the
// write queue across those bundles, not a palette cache. One frontend writer
// process per storage volume is supported; this is not a distributed lock.
const globalQueues = globalThis as typeof globalThis & {
  asterismThemeWrites?: Map<string, Promise<void>>;
};
const queues = (globalQueues.asterismThemeWrites ??= new Map());

async function serializeWrite<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(key) === current) queues.delete(key);
  }
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// The configured storage root is trusted; its themes child may not be a symlink.
async function customDirectory(storageRoot: string, create: boolean) {
  if (!path.isAbsolute(storageRoot))
    throw new Error("Theme storage root must be absolute");
  if (create) await fs.mkdir(storageRoot, { recursive: true });
  let root: string;
  try {
    root = await fs.realpath(storageRoot);
  } catch (error) {
    if (!create && isMissing(error)) return null;
    throw error;
  }
  const directory = path.join(root, "themes");
  if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    if ((await fs.realpath(directory)) !== directory)
      throw new Error("Invalid theme storage directory");
  } catch (error) {
    if (!create && isMissing(error)) return null;
    throw error;
  }
  return directory;
}

function themePath(directory: string, id: string) {
  themeIdSchema.parse(id);
  const target = path.resolve(directory, `${id}.json`);
  if (path.dirname(target) !== directory) throw new Error("Invalid theme path");
  return target;
}

async function readCustomTheme(directory: string, id: string): Promise<Theme> {
  const file = await fs.open(
    themePath(directory, id),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    if (!(await file.stat()).isFile()) throw new Error("Theme is not a file");
    const data = themeDataSchema.parse(JSON.parse(await file.readFile("utf8")));
    return { ...data, filename: id };
  } finally {
    await file.close();
  }
}

async function atomicSave(directory: string, theme: Theme) {
  const target = themePath(directory, theme.filename);
  try {
    if (!(await fs.lstat(target)).isFile())
      throw new Error("Theme target must be a regular file");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  // Persist only validated theme fields; the filename is the storage key.
  const { filename: _filename, ...data } = theme;
  void _filename;
  let file;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    await file.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
    await file.sync();
    await file.close();
    file = undefined;
    // Same-directory rename is the commit point. No fallible work follows it.
    await fs.rename(temporary, target);
  } finally {
    await file?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

export function createThemeRepository(
  storageRoot: string,
  bundled: Record<string, unknown>,
): ThemeRepository {
  async function list() {
    const themes: Record<string, Theme> = {};
    for (const [id, data] of Object.entries(bundled)) {
      const parsed = themeDataSchema.safeParse(data);
      if (themeIdSchema.safeParse(id).success && parsed.success) {
        themes[id] = { ...parsed.data, filename: id };
      } else console.warn("Ignoring invalid bundled theme", id);
    }
    const directory = await customDirectory(storageRoot, false);
    if (!directory) return themes;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!themeIdSchema.safeParse(id).success) continue;
      try {
        themes[id] = await readCustomTheme(directory, id);
      } catch {
        console.warn("Ignoring unreadable or invalid custom theme", id);
      }
    }
    return themes;
  }

  async function read(id: string) {
    themeIdSchema.parse(id);
    const themes = await list();
    if (!Object.hasOwn(themes, id))
      throw new ThemeRepositoryError("NOT_FOUND", "Unknown theme");
    return themes[id];
  }

  async function save(input: unknown) {
    const parsed = themeSaveSchema.safeParse(input);
    if (!parsed.success)
      throw new ThemeRepositoryError(
        "INVALID_THEME",
        "Check the theme name, ID, hex colors and shape values.",
      );
    try {
      // Resolve a canonical queue key before serializing name checks and writes.
      const directory = (await customDirectory(storageRoot, true))!;
      return await serializeWrite(directory, async () => {
        const { filename, ...data } = parsed.data;
        const themes = await list();
        if (filename && !Object.hasOwn(themes, filename)) {
          throw new ThemeRepositoryError("NOT_FOUND", "Unknown theme");
        }
        if (
          Object.values(themes).some(
            (theme) =>
              theme.filename !== filename &&
              theme.name.toLowerCase() === data.name.toLowerCase(),
          )
        ) {
          throw new ThemeRepositoryError(
            "DUPLICATE_NAME",
            "A theme with that name already exists.",
          );
        }
        const theme: Theme = { ...data, filename: filename || randomUUID() };
        await atomicSave(directory, theme);
        return theme;
      });
    } catch (error) {
      if (error instanceof ThemeRepositoryError) throw error;
      throw new ThemeRepositoryError(
        "STORAGE_ERROR",
        "Theme could not be saved. Your edits are still here; try again.",
      );
    }
  }
  return { list, read, save };
}
