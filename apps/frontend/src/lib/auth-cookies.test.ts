import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";

// US-86.5: under an HTTPS PUBLIC_URL every auth cookie is Secure, HttpOnly
// and SameSite=Lax, from a real Better Auth instance with this app's options.
const directory = mkdtempSync(join(tmpdir(), "asterism-cookies-"));

vi.mock("./server-config-core", () => ({
  getFrontendServerConfig: () => ({
    profile: "test",
    publicUrl: "https://asterism.example",
    betterAuthSecret: "cookie-test-secret-000000000000000000",
    systemKey: "cookie-test-system-key-0000000000000",
    adminPassphrase: "cookie-test-admin-passphrase",
    authDbPath: join(directory, "users.db"),
  }),
}));

afterAll(() => rmSync(directory, { recursive: true, force: true }));

function cookieAttributes(header: string) {
  const [pair, ...attributes] = header.split(";").map((part) => part.trim());
  return {
    name: pair.split("=")[0],
    attributes: new Set(attributes.map((part) => part.toLowerCase())),
  };
}

it("sets Secure, HttpOnly, SameSite=Lax session cookies", async () => {
  const { getAuth } = await import("./auth-core");
  const auth = getAuth();
  await (await auth.$context).runMigrations();

  const response = await auth.handler(
    new Request(
      "https://asterism.example/api/auth/sign-up/email?adminKey=cookie-test-admin-passphrase",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://asterism.example",
        },
        body: JSON.stringify({
          name: "Cookie Test",
          email: "cookie@example.test",
          password: "Orbital-283!",
        }),
      },
    ),
  );
  expect(response.status).toBe(200);
  const cookies = response.headers.getSetCookie().map(cookieAttributes);
  expect(cookies.map((cookie) => cookie.name)).toContain(
    "__Secure-better-auth.session_token",
  );
  for (const cookie of cookies) {
    expect(cookie.name).toMatch(/^__Secure-/);
    expect(cookie.attributes).toContain("secure");
    expect(cookie.attributes).toContain("httponly");
    expect(cookie.attributes).toContain("samesite=lax");
    expect(cookie.attributes).toContain("path=/");
  }
});
