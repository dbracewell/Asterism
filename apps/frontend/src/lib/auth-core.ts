import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

import { getFrontendServerConfig } from "./server-config-core";

export function matchesAdminPassphrase(
  candidate: unknown,
  configured: string,
): boolean {
  if (typeof candidate !== "string" || !candidate || !configured) {
    return false;
  }
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const configuredDigest = createHash("sha256").update(configured).digest();
  return timingSafeEqual(candidateDigest, configuredDigest);
}

/**
 * Who may create an account, and with what role. Throws when nobody may.
 *
 * - An invite signup comes only from the server action that then claims the
 *   invite (it holds the system key) and always makes an ordinary user.
 * - Otherwise the admin key or a signed-in admin is required.
 */
export function decideSignupRole({
  query,
  sessionRole,
  requestedRole,
  adminPassphrase,
  systemKey,
}: {
  query: Record<string, unknown>;
  sessionRole: string | undefined;
  requestedRole: unknown;
  adminPassphrase: string;
  systemKey: string;
}): "admin" | "user" {
  if (
    typeof query.inviteToken === "string" &&
    matchesAdminPassphrase(query.systemKey, systemKey)
  ) {
    return "user";
  }
  const hasValidAdminKey = matchesAdminPassphrase(
    query.adminKey,
    adminPassphrase,
  );
  if (!hasValidAdminKey && sessionRole !== "admin") {
    throw new Error("Invalid admin key");
  }
  if (query.role === "user") return "user";
  if (hasValidAdminKey) return "admin";
  return requestedRole === "admin" ? "admin" : "user";
}

function createAuth() {
  const config = getFrontendServerConfig();
  mkdirSync(dirname(config.authDbPath), { recursive: true });
  return betterAuth({
    baseURL: config.publicUrl,
    secret: config.betterAuthSecret,
    database: new Database(config.authDbPath),
    // Browser tests run a production build and create many accounts and
    // sessions from one address in parallel; production keeps the limiter.
    ...(config.profile === "test" && { rateLimit: { enabled: false } }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 32,
    },
    plugins: [
      jwt({
        jwks: {
          rotationInterval: 60 * 60 * 24 * 30,
          gracePeriod: 60 * 60 * 24 * 2,
          keyPairConfig: {
            alg: "RS256",
          },
        },
      }),
      admin(),
      nextCookies(),
    ],
    user: {
      additionalFields: {
        role: {
          type: ["admin", "user"],
          required: false,
          defaultValue: "user",
          input: false,
        },
        timezone: {
          type: "string",
          required: false,
          defaultValue: "UTC",
          input: true,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const role = decideSignupRole({
              query: (ctx?.query ?? {}) as Record<string, unknown>,
              sessionRole: (
                ctx?.context as
                  | { session?: { user?: { role?: string } } }
                  | undefined
              )?.session?.user?.role,
              requestedRole: user.role,
              adminPassphrase: config.adminPassphrase,
              systemKey: config.systemKey,
            });
            return { data: { ...user, role } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
