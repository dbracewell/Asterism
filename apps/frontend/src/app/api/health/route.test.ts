import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  open: vi.fn(),
  signJWT: vi.fn(),
}));

vi.mock("better-sqlite3", () => ({
  default: class {
    constructor(path: string, options: unknown) {
      mocks.open(path, options);
    }
    exec(sql: string) {
      mocks.exec(sql);
    }
    close() {}
  },
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { signJWT: mocks.signJWT } }),
}));
vi.mock("@/lib/server-config-core", () => ({
  getFrontendServerConfig: () => ({ authDbPath: "/storage/users.db" }),
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  let now = Date.now();

  beforeEach(() => {
    // Each test starts past the previous test's cached result.
    now += 60_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.clearAllMocks();
    mocks.exec.mockReset();
    mocks.signJWT.mockResolvedValue({ token: "header.payload.signature" });
  });

  it("is ready when the auth database takes a write lock and the key signs", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ready: true,
      checks: [
        { name: "auth_database", ok: true, detail: "" },
        { name: "auth_signing_key", ok: true, detail: "" },
      ],
    });
    expect(mocks.open).toHaveBeenCalledWith("/storage/users.db", {
      fileMustExist: true,
      timeout: 2000,
    });
    expect(mocks.exec).toHaveBeenCalledWith("BEGIN IMMEDIATE; ROLLBACK;");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is not ready, without internal detail, when either check fails", async () => {
    mocks.exec.mockImplementation(() => {
      throw new Error("SQLITE_READONLY: /storage/users.db");
    });
    mocks.signJWT.mockRejectedValue(new Error("decrypt failed with secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ready).toBe(false);
    expect(body.checks.map((check: { ok: boolean }) => check.ok)).toEqual([
      false,
      false,
    ]);
    expect(JSON.stringify(body)).not.toMatch(/storage|secret|SQLITE/);
  });

  it("reuses one result for a few seconds, including for concurrent callers", async () => {
    const responses = await Promise.all([GET(), GET(), GET()]);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    expect(mocks.signJWT).toHaveBeenCalledTimes(1);
    now += 4000;
    await GET();
    expect(mocks.signJWT).toHaveBeenCalledTimes(1);
    now += 2000;
    await GET();
    expect(mocks.signJWT).toHaveBeenCalledTimes(2);
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });
});
