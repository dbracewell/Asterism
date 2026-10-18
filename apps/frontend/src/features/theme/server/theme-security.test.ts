import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import light from "../bundled/light.json";

vi.mock("server-only", () => ({}));
const { getSession, revalidatePath } = vi.hoisted(() => ({
  getSession: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { loadTheme, saveTheme } from "./actions";
import { getAllThemes, readCatalogTheme } from "./catalog";
import { GET } from "@/app/api/theme/route";
import { GET as list } from "@/app/api/theme/list/route";
import { NextRequest } from "next/server";
import { themeSaveSchema } from "../schemas";
vi.mock("../bundled", async () => ({
  bundledThemes: { light: (await import("../bundled/light.json")).default },
}));
vi.mock("@/lib/server-config", () => ({
  getFrontendServerConfig: () => ({ storageRoot: root }),
}));

let root: string;
let directory: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "asterism-theme-"));
  directory = path.join(root, "themes");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "light.json"), JSON.stringify(light));
  getSession.mockResolvedValue({ user: { role: "admin" } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

const request = (id?: string) =>
  new NextRequest(
    `http://localhost/api/theme${id === undefined ? "" : `?name=${encodeURIComponent(id)}`}`,
  );

describe("public theme catalog", () => {
  it("validates every bundled palette against the runtime schema", async () => {
    const { bundledThemes } = await vi.importActual<{
      bundledThemes: Record<string, unknown>;
    }>("../bundled");
    expect(Object.keys(bundledThemes)).toHaveLength(8);
    for (const [id, data] of Object.entries(bundledThemes)) {
      expect(themeSaveSchema.safeParse(data).success, id).toBe(true);
    }
  });
  it("lists and reads validated palettes without authentication", async () => {
    getSession.mockResolvedValue(null);
    expect(await (await list()).json()).toEqual([
      { name: light.name, filename: "light" },
    ]);
    expect(await (await GET(request("light"))).json()).toEqual({
      ...light,
      filename: "light",
    });
    expect(getSession).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    "",
    "../sentinel",
    "../../sentinel",
    "/tmp/sentinel",
    "..\\sentinel",
    "%2e%2e%2fsentinel",
    "light.json",
    "LIGHT",
    "a\0",
    "constructor",
    "__proto__",
  ])("rejects invalid or absent catalog entry %s", async (id) => {
    const response = await GET(request(id));
    expect([400, 404]).toContain(response.status);
    expect(await response.text()).not.toContain("SECRET_SENTINEL");
  });
  it("rejects symlinks, including a harmless outside JSON sentinel", async () => {
    await writeFile(
      path.join(root, "sentinel.json"),
      JSON.stringify({ ...light, name: "SECRET_SENTINEL" }),
    );
    await symlink(
      path.join(root, "sentinel.json"),
      path.join(directory, "escape.json"),
    );
    await symlink(
      path.join(directory, "light.json"),
      path.join(directory, "alias.json"),
    );
    expect((await GET(request("escape"))).status).toBe(404);
    expect((await GET(request("alias"))).status).toBe(404);
    expect(Object.keys(await getAllThemes())).toEqual(["light"]);
    expect(await saveTheme({ ...light, filename: "escape" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(
      JSON.parse(await readFile(path.join(root, "sentinel.json"), "utf8")).name,
    ).toBe("SECRET_SENTINEL");
  });
});

describe("direct editor actions", () => {
  it.each([null, { user: { role: "user" } }, { user: {} }])(
    "denies non-admin session %j before file access",
    async (session) => {
      getSession.mockResolvedValue(session);
      await rm(directory, { recursive: true });
      await expect(loadTheme("light")).rejects.toThrow(/required/);
      await expect(saveTheme({ ...light, filename: "light" })).rejects.toThrow(
        /required/,
      );
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
  it("allows admin reads, updates and new catalog entries", async () => {
    expect((await loadTheme("light")).name).toBe(light.name);
    await saveTheme({ ...light, filename: "light", name: "Updated" });
    expect((await readCatalogTheme("light")).name).toBe("Updated");
    await saveTheme({ ...light, filename: "", name: "New" });
    expect(
      Object.values(await getAllThemes())
        .map((theme) => theme.name)
        .sort(),
    ).toEqual(["New", "Updated"]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it.each(["../sentinel", "/tmp/sentinel", "light.json", "..\\sentinel"])(
    "rejects editor filename %s",
    async (filename) => {
      await expect(loadTheme(filename)).rejects.toThrow();
      expect(await saveTheme({ ...light, filename })).toMatchObject({
        ok: false,
        error: { code: "INVALID_THEME" },
      });
      expect(
        JSON.parse(await readFile(path.join(directory, "light.json"), "utf8")),
      ).toEqual(light);
    },
  );
  it.each([
    {
      ...light,
      colors: { ...light.colors, background: "url(https://example.com)" },
    },
    { ...light, colors: { ...light.colors, extra: "#fff" } },
    { ...light, colors: {} },
    { ...light, name: " " },
    { ...light, type: "invalid" },
    { ...light, unknown: true },
  ])("rejects malformed payload before IO", async (input) => {
    await rm(directory, { recursive: true });
    expect(await saveTheme(input)).toMatchObject({
      ok: false,
      error: { code: "INVALID_THEME" },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("returns a typed storage failure without success invalidation", async () => {
    await rm(directory, { recursive: true });
    await writeFile(directory, "blocked");
    expect(await saveTheme({ ...light, name: "Retained draft" })).toEqual({
      ok: false,
      error: {
        code: "STORAGE_ERROR",
        message:
          "Theme could not be saved. Your edits are still here; try again.",
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("does not misreport a committed write when layout revalidation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("refresh unavailable");
    });
    expect(
      await saveTheme({ ...light, filename: "light", name: "Committed" }),
    ).toMatchObject({
      ok: true,
      theme: { filename: "light", name: "Committed" },
    });
    expect((await readCatalogTheme("light")).name).toBe("Committed");
  });
  it("does not create a caller-selected unknown ID or duplicate name", async () => {
    expect(await saveTheme({ ...light, filename: "unknown" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await saveTheme(light)).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_NAME" },
    });
    expect(Object.keys(await getAllThemes())).toEqual(["light"]);
  });
});
