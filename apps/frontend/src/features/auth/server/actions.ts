"use server";
import {
  InstallUserSchema,
  InstallUserSchemaType,
  InviteSignupSchema,
  InviteSignupSchemaType,
} from "@/features/auth/schemas";
import { getAuth } from "@/lib/auth";
import { BACKEND_API_URL } from "@/lib/backend-url";
import { getFrontendServerConfig } from "@/lib/server-config";
import { headers } from "next/headers";
import { checkInvite, inviteSignupLimiter, redeemInvite } from "./invites";
import { countAdmins, countUsers } from "./session";
import { clientIpKey } from "@/lib/rate-limit";

export const installApp = async (data: InstallUserSchemaType) => {
  const parsed = InstallUserSchema.safeParse(data);
  if (!parsed.success) {
    throw Error(parsed.error.message);
  }

  const existingUsers = await countUsers();
  if (existingUsers > 0) {
    throw Error("Application is already installed");
  }

  let user;
  try {
    const headerList = await headers();
    user = await getAuth().api.signUpEmail({
      headers: headerList,
      body: { ...parsed.data },
      query: { adminKey: parsed.data.adminKey, install: true },
    });
  } catch (error: unknown) {
    throw Error(error instanceof Error ? error.message : JSON.stringify(error));
  }

  try {
    const result = await fetch(`${BACKEND_API_URL}/users/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({
        user_id: user.user.id,
        system_key: getFrontendServerConfig().systemKey,
      }),
    });

    if (!result.ok) {
      let detail = "Failed to provision user in backend";
      try {
        const errorBody = await result.json();
        if (errorBody?.detail) {
          detail = String(errorBody.detail);
        }
      } catch {
        // Ignore JSON parse errors on non-JSON failure responses
      }
      throw Error(detail);
    }
  } catch (error: unknown) {
    try {
      const context = await getAuth().$context;
      await context.internalAdapter.deleteUser(user.user.id);
    } catch {
      // Best-effort rollback so failed backend provisioning does not brick install
    }
    throw error instanceof Error ? error : Error(String(error));
  }
};

export type InviteSignupResult =
  | { ok: true; className: string }
  | { ok: false; error: string };

/**
 * Create an ordinary account through a single-use class invite.
 *
 * The account is created first and then provisioned by claiming the invite;
 * if the claim fails (used, expired, revoked, or lost a race) the account is
 * deleted again. Results are returned rather than thrown because production
 * builds hide server action error messages.
 */
export const signUpWithInvite = async (
  data: InviteSignupSchemaType,
): Promise<InviteSignupResult> => {
  const parsed = InviteSignupSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form",
    };
  }
  const headerList = await headers();
  if (
    !inviteSignupLimiter.attempt(clientIpKey(headerList.get("x-forwarded-for")))
  ) {
    return {
      ok: false,
      error: "Too many sign-up attempts. Try again in a few minutes.",
    };
  }
  // Invites only work once an administrator has set Asterism up.
  if ((await countAdmins()) === 0) {
    return { ok: false, error: "Asterism hasn't been set up yet." };
  }
  const { token, name, email, password } = parsed.data;
  const check = await checkInvite(token);
  if (!check.ok) return check;

  let user;
  try {
    user = await getAuth().api.signUpEmail({
      headers: headerList,
      body: { name, email, password },
      query: {
        inviteToken: token,
        systemKey: getFrontendServerConfig().systemKey,
      },
    });
  } catch (error: unknown) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Couldn't create the account",
    };
  }

  let redeemed;
  try {
    redeemed = await redeemInvite(token, user.user.id, name);
  } catch {
    redeemed = {
      ok: false as const,
      error: "Couldn't reach Asterism. Try again in a moment.",
    };
  }
  if (!redeemed.ok) {
    try {
      const context = await getAuth().$context;
      await context.internalAdapter.deleteUser(user.user.id);
    } catch {
      // Best effort: the account has no backend user, so it can't be used.
    }
    return redeemed;
  }
  return { ok: true, className: redeemed.preview.class_name };
};
