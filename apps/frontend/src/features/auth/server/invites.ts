import "server-only";

import { BACKEND_API_URL } from "@/lib/backend-url";
import { createRateLimiter } from "@/lib/rate-limit";
import { getFrontendServerConfig } from "@/lib/server-config";

export const INVALID_INVITE =
  "This invite can't be used. Ask your educator for a new one.";

// Invites are random enough not to be guessed; this slows account spam and
// probing from one address. Per process, like the other rate limits.
export const inviteSignupLimiter = createRateLimiter({
  max: 10,
  windowMs: 15 * 60_000,
});

export type InvitePreview = { class_name: string; educator_name: string };

type InviteResult =
  | { ok: true; preview: InvitePreview }
  | { ok: false; error: string };

/** Server-to-server; the backend accepts these only with the system key. */
async function postInvite(
  path: "check" | "redeem",
  body: Record<string, string>,
): Promise<InviteResult> {
  const response = await fetch(`${BACKEND_API_URL}/class-invites/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      system_key: getFrontendServerConfig().systemKey,
    }),
    cache: "no-store",
  });
  if (response.ok) {
    return { ok: true, preview: (await response.json()) as InvitePreview };
  }
  let error = INVALID_INVITE;
  if (response.status !== 400) {
    error = "Couldn't reach Asterism. Try again in a moment.";
  }
  return { ok: false, error };
}

export function checkInvite(token: string) {
  return postInvite("check", { token });
}

export function redeemInvite(
  token: string,
  userId: string,
  displayName: string,
) {
  return postInvite("redeem", {
    token,
    user_id: userId,
    display_name: displayName,
  });
}
