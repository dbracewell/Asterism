import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

import { getFrontendServerConfig } from "./server-config-core";

function createAuth() {
  const config = getFrontendServerConfig();
  mkdirSync(dirname(config.authDbPath), { recursive: true });
  return betterAuth({
    baseURL: config.publicUrl,
    secret: config.betterAuthSecret,
    database: new Database(config.authDbPath),
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
            let role = "user";
            const adminKey = ctx!.query?.adminKey;
            const install = ctx!.query?.install;
            if (adminKey === config.adminPassphrase) {
              role = "admin";
            }
            if (install && role !== "admin") {
              throw new Error("Invalid admin key");
            }
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
