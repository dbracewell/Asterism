import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Auth } from "./auth-core";

// US-112.1: once an account exists, the admin passphrase alone no longer
// creates accounts over HTTP; operator tooling adds the system key.
const directory = mkdtempSync(join(tmpdir(), "asterism-signup-"));
const PASSPHRASE = "signup-test-admin-passphrase";
const SYSTEM_KEY = "signup-test-system-key-00000000000000";

vi.mock("./server-config-core", () => ({
  getFrontendServerConfig: () => ({
    profile: "test",
    publicUrl: "https://asterism.example",
    betterAuthSecret: "signup-test-secret-000000000000000000",
    systemKey: SYSTEM_KEY,
    adminPassphrase: PASSPHRASE,
    authDbPath: join(directory, "users.db"),
  }),
}));

afterAll(() => rmSync(directory, { recursive: true, force: true }));

let auth: Auth;
beforeAll(async () => {
  const { getAuth } = await import("./auth-core");
  auth = getAuth();
  await (await auth.$context).runMigrations();
});

async function signUp(email: string, query: Record<string, string>) {
  const response = await auth.handler(
    new Request(
      `https://asterism.example/api/auth/sign-up/email?${new URLSearchParams(query)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://asterism.example",
        },
        body: JSON.stringify({ name: email, email, password: "Orbital-283!" }),
      },
    ),
  );
  return {
    status: response.status,
    role: response.ok
      ? ((await response.json()) as { user: { role: string } }).user.role
      : undefined,
  };
}

it("takes the passphrase alone only before anyone has an account", async () => {
  expect(await signUp("first@example.test", { adminKey: PASSPHRASE })).toEqual({
    status: 200,
    role: "admin",
  });
  expect(
    (await signUp("second@example.test", { adminKey: PASSPHRASE })).status,
  ).not.toBe(200);
  expect(
    (
      await signUp("third@example.test", {
        adminKey: PASSPHRASE,
        systemKey: "wrong",
      })
    ).status,
  ).not.toBe(200);
  expect(
    await signUp("fourth@example.test", {
      adminKey: PASSPHRASE,
      systemKey: SYSTEM_KEY,
      role: "user",
    }),
  ).toEqual({ status: 200, role: "user" });
});
