import {
  adminClient,
  inferAdditionalFields,
  jwtClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { auth } from "@/lib/auth";

export const authClient = createAuthClient({
  plugins: [jwtClient(), adminClient(), inferAdditionalFields<typeof auth>()],
});
