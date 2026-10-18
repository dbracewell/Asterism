import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import light from "../bundled/light.json";

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
import { createThemeRepository } from "./repository";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "asterism-theme-repo-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.rename).mockClear();
  await fs.rm(root, { recursive: true, force: true });
});
const repository = () => createThemeRepository(root, { light });

describe("durable theme repository", () => {
  it("reads defaults without creating storage and saves overrides separately", async () => {
    const missingRoot = path.join(root, "not-created");
    expect(
      (await createThemeRepository(missingRoot, { light }).read("light")).name,
    ).toBe(light.name);
    await expect(fs.stat(missingRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const saved = await repository().save({
      ...light,
      filename: "light",
      name: "Override",
    });
    expect(saved.filename).toBe("light");
    expect(light.name).toBe("Default Light Theme");
    const file = path.join(root, "themes", "light.json");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
      ...light,
      name: "Override",
    });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    expect((await repository().read("light")).name).toBe("Override");
  });
  it("retains the last committed file on rename failure, cleans up and permits retry", async () => {
    const original = await repository().save({ ...light, name: "Original" });
    const target = path.join(root, "themes", `${original.filename}.json`);
    const before = await fs.readFile(target, "utf8");
    vi.mocked(fs.rename).mockRejectedValueOnce(
      Object.assign(new Error("private path"), { code: "EIO" }),
    );
    await expect(
      repository().save({ ...original, name: "Retried" }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
    expect(await fs.readFile(target, "utf8")).toBe(before);
    expect(await fs.readdir(path.dirname(target))).toEqual([
      `${original.filename}.json`,
    ]);
    await repository().save({ ...original, name: "Retried" });
    expect((await repository().read(original.filename)).name).toBe("Retried");
  });
  it("does not publish a new file or reserve its name on failed creation", async () => {
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("write failed"));
    await expect(
      repository().save({ ...light, name: "New theme" }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
    expect(await fs.readdir(path.join(root, "themes"))).toEqual([]);
    const saved = await repository().save({ ...light, name: "New theme" });
    expect((await repository().read(saved.filename)).name).toBe("New theme");
  });
  it("isolates malformed files and ignores temporary files while retaining valid overrides/defaults", async () => {
    await repository().save({ ...light, filename: "light", name: "Override" });
    const directory = path.join(root, "themes");
    await fs.writeFile(path.join(directory, "bad-json.json"), "{");
    await fs.writeFile(
      path.join(directory, "bad-schema.json"),
      JSON.stringify({ ...light, colors: {} }),
    );
    await fs.writeFile(path.join(directory, ".incomplete.tmp"), "{");
    const themes = await repository().list();
    expect(Object.keys(themes)).toEqual(["light"]);
    expect(themes.light.name).toBe("Override");
    expect(console.warn).toHaveBeenCalledTimes(2);
    await fs.writeFile(path.join(directory, "light.json"), "invalid");
    expect((await repository().read("light")).name).toBe(light.name);
    await repository().save({ ...light, filename: "light", name: "Repaired" });
    expect((await repository().read("light")).name).toBe("Repaired");
  });
  it("rejects duplicate names on create and rename, including concurrent saves through separate instances", async () => {
    const results = await Promise.allSettled([
      repository().save({ ...light, name: "Concurrent" }),
      repository().save({ ...light, name: "concurrent" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "DUPLICATE_NAME" } });
    const other = await repository().save({ ...light, name: "Other" });
    await expect(
      repository().save({ ...other, name: " Concurrent " }),
    ).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    expect((await repository().read(other.filename)).name).toBe("Other");
  });
  it("refreshes without a process cache and leaves readers on committed data during a write", async () => {
    const first = repository();
    const second = repository();
    const original = await first.save({ ...light, name: "Before" });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const realRename = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      await realRename.rename(...args);
    });
    const writing = first.save({ ...original, name: "After" });
    await ready;
    try {
      expect((await second.read(original.filename)).name).toBe("Before");
    } finally {
      release();
    }
    await writing;
    expect((await second.read(original.filename)).name).toBe("After");
    expect((await repository().read(original.filename)).name).toBe("After");
  });
  it("rejects a symlinked custom root and never writes outside storage", async () => {
    const outside = await fs.mkdtemp(path.join(tmpdir(), "asterism-outside-"));
    try {
      await fs.symlink(outside, path.join(root, "themes"));
      await expect(
        repository().save({ ...light, name: "Escape" }),
      ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
  it("rejects symlinked override targets and a blocked storage directory", async () => {
    await fs.mkdir(path.join(root, "themes"));
    const sentinel = path.join(root, "sentinel.json");
    await fs.writeFile(sentinel, JSON.stringify(light));
    await fs.symlink(sentinel, path.join(root, "themes", "light.json"));
    await expect(
      repository().save({ ...light, filename: "light", name: "Escape" }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
    expect(JSON.parse(await fs.readFile(sentinel, "utf8"))).toEqual(light);
    await fs.rm(path.join(root, "themes"), { recursive: true });
    await fs.writeFile(path.join(root, "themes"), "blocked");
    await expect(
      repository().save({ ...light, name: "Blocked" }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });
});
