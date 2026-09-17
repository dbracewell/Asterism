import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getFrontendServerConfig,
  resetFrontendServerConfigForTests,
} from "./server-config";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "asterism-frontend-config-"));
  temporaryDirectories.push(path);
  return path;
}

beforeEach(() => {
  process.env = { ...originalEnvironment };
  resetFrontendServerConfigForTests();
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  resetFrontendServerConfigForTests();
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function validProductionEnvironment(root: string) {
  process.env.ASTERISM_CONFIG_PROFILE = "production";
  process.env.PUBLIC_URL = "https://asterism.example.com";
  process.env.BETTER_AUTH_SECRET = "valid-better-auth-secret-000000000";
  process.env.SYSTEM_KEY = "valid-system-key-00000000000000000";
  process.env.ADMIN_PASSPHRASE = "valid-admin-passphrase";
  process.env.STORAGE_ROOT = join(root, "storage");
  process.env.BETTER_AUTH_DB_PATH = join(root, "storage", "users.db");
}

describe("frontend server configuration", () => {
  it("validates without creating storage or a database", () => {
    const root = temporaryDirectory();
    validProductionEnvironment(root);
    const config = getFrontendServerConfig();
    expect(config.publicUrl).toBe("https://asterism.example.com");
    expect(existsSync(join(root, "storage"))).toBe(false);
  });

  it("redacts rejected secret values", () => {
    const root = temporaryDirectory();
    validProductionEnvironment(root);
    const canary = "replace-with-frontend-secret-canary";
    process.env.BETTER_AUTH_SECRET = canary;
    expect(() => getFrontendServerConfig()).toThrowError(
      /BETTER_AUTH_SECRET.*value redacted/,
    );
    try {
      getFrontendServerConfig();
    } catch (error) {
      expect(String(error)).not.toContain(canary);
    }
  });

  it("does not require runtime credentials for builds", () => {
    process.env = {
      ...originalEnvironment,
      ASTERISM_CONFIG_PROFILE: "build",
    };
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.SYSTEM_KEY;
    delete process.env.ADMIN_PASSPHRASE;
    expect(getFrontendServerConfig().profile).toBe("build");
  });

  it("does not log rejected system-key headers", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/stream/route.ts"),
      "utf8",
    );
    expect(route).not.toMatch(/console\.(?:log|error|warn)\(systemKey\)/);
  });

  it("does not open the auth database when the module is imported", async () => {
    const root = temporaryDirectory();
    process.env.ASTERISM_CONFIG_PROFILE = "build";
    process.env.BETTER_AUTH_DB_PATH = join(root, "users.db");
    vi.resetModules();
    await import("./auth");
    expect(existsSync(join(root, "users.db"))).toBe(false);
  });
});
