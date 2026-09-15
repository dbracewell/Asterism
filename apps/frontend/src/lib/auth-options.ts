import type { BetterAuthOptions } from "better-auth";
import { admin, jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

// Shared by Next.js and the container's non-destructive startup migrations.
export const authOptions = {
  database: new Database(process.env.BETTER_AUTH_DB_PATH!),
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
          if (adminKey === process.env.ADMIN_PASSPHRASE!) {
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
} satisfies BetterAuthOptions;
