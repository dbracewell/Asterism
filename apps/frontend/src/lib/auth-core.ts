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
            const adminKey = ctx?.query?.adminKey;
            const requestedRole = ctx?.query?.role;
            const hasValidAdminKey = matchesAdminPassphrase(
              adminKey,
              config.adminPassphrase,
            );
            const sessionRole = (
              ctx?.context as
                | { session?: { user?: { role?: string } } }
                | undefined
            )?.session?.user?.role;
            const isAuthorizedAdmin =
              hasValidAdminKey || sessionRole === "admin";

            if (!isAuthorizedAdmin) {
              throw new Error("Invalid admin key");
            }

            const role =
              requestedRole === "user"
                ? "user"
                : hasValidAdminKey
                  ? "admin"
                  : user.role === "admin"
                    ? "admin"
                    : "user";

            return {
              data: {
                ...user,
                role,
              },
            };
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
