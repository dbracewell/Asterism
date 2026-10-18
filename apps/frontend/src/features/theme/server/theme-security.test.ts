import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import light from "../../../../public/themes/light.json";

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
const repositoryRoot = process.cwd();

let root: string;
let directory: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "asterism-theme-"));
  directory = path.join(root, "public", "themes");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "light.json"), JSON.stringify(light));
  vi.spyOn(process, "cwd").mockReturnValue(root);
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
    const bundled = path.join(repositoryRoot, "public", "themes");
    for (const file of await readdir(bundled)) {
      if (file.endsWith(".json")) {
        expect(
          themeSaveSchema.safeParse(
            JSON.parse(await readFile(path.join(bundled, file), "utf8")),
          ).success,
          file,
        ).toBe(true);
      }
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
    await expect(saveTheme({ ...light, filename: "escape" })).rejects.toThrow(
      "Unknown theme",
    );
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
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
  it.each(["../sentinel", "/tmp/sentinel", "light.json", "..\\sentinel"])(
    "rejects editor filename %s",
    async (filename) => {
      await expect(loadTheme(filename)).rejects.toThrow();
      await expect(saveTheme({ ...light, filename })).rejects.toThrow();
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
    await expect(saveTheme(input)).rejects.toThrow(
      /Invalid|expected|Unrecognized|Too small/,
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("does not create a caller-selected unknown ID or duplicate name", async () => {
    await expect(saveTheme({ ...light, filename: "unknown" })).rejects.toThrow(
      "Unknown theme",
    );
    await expect(saveTheme(light)).rejects.toThrow("Theme name already exists");
    expect(Object.keys(await getAllThemes())).toEqual(["light"]);
  });
});
