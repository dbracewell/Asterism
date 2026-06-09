import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

export const auth = betterAuth({
  database: new Database(process.env.BETTER_AUTH_DB_PATH!),
  emailAndPassword: {
    enabled: true,
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
    nextCookies(),
  ],
});
