import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

import { getFrontendServerConfig } from "./server-config-core";

export function hashMatch(candidate: unknown, configured: string): boolean {
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
    hashMatch(query.systemKey, systemKey)
  ) {
    return "user";
  }
  const hasValidAdminKey = hashMatch(query.adminKey, adminPassphrase);
  if (!hasValidAdminKey && sessionRole !== "admin") {
    throw new Error("Invalid admin key");
  }
  if (query.role === "user") return "user";
  if (hasValidAdminKey) return "admin";
  return requestedRole === "admin" ? "admin" : "user";
}

export const SUSPENDED_MESSAGE =
  "This account is suspended. Ask your administrator.";

/** How long an admin-issued password reset link works. */
export const RESET_LINK_TTL_SECONDS = 60 * 60;

/** Better Auth routes that stay callable from the server but not over HTTP. */
export const LIFECYCLE_PATHS_WITHOUT_HTTP = [
  "/admin/ban-user",
  "/admin/unban-user",
  "/admin/remove-user",
  "/request-password-reset",
];

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
    // Account lifecycle runs only through the admin server actions, which also
    // update the backend (US-86.2). Password resets use admin-issued links, so
    // there is no public "email me a link" request.
    disabledPaths: LIFECYCLE_PATHS_WITHOUT_HTTP,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 32,
      // A reset ends every session (US-86.2); links come from admins.
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_LINK_TTL_SECONDS,
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
      admin({ bannedUserMessage: SUSPENDED_MESSAGE }),
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
