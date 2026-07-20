import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

export const auth = betterAuth({
  database: new Database(process.env.BETTER_AUTH_DB_PATH!),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 16,
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
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          let role = "user";
          const adminKey = ctx!.query?.adminKey;
          if (adminKey === process.env.ADMIN_PASSPHRASE!) {
            role = "admin";
          }
          console.log(adminKey, role);
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
