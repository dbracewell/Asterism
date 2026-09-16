import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { authOptions } from "./auth-options";

export const auth = betterAuth({
  ...authOptions,
  plugins: [...authOptions.plugins, nextCookies()],
});
