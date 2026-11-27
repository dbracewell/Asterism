"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";

import { getApiClient } from "@/lib/api-server";
import { getAuth } from "@/lib/auth";
import { RESET_LINK_TTL_SECONDS } from "@/lib/auth-core";
import { getFrontendServerConfig } from "@/lib/server-config";

/**
 * Admin account lifecycle (US-86.2). Each action changes both stores in an
 * order chosen so a partial failure is safe and retrying finishes the job:
 *
 * - Suspend: the backend first (refuses tokens, stops work), then the Better
 *   Auth ban (blocks sign-in, revokes sessions).
 * - Reactivate: lift the ban, then the backend suspension.
 * - Delete: the Better Auth account first, then the backend data. A retry
 *   treats an already-missing auth account as done.
 *
 * Better Auth checks the caller's admin permission and refuses self-ban and
 * self-removal; the backend checks again. Results are returned rather than
 * thrown because production builds hide server action error messages.
 */

export type LifecycleResult = { ok: true } | { ok: false; error: string };

export type ResetLinkResult =
  { ok: true; url: string; expiresAt: string } | { ok: false; error: string };

type Session = { user: { id: string; role?: string | null } };

const UNREACHABLE = "Couldn't reach Asterism. Try again in a moment.";

async function adminSession(): Promise<
  { session: Session; headers: Headers } | { error: string }
> {
  const headerList = await headers();
  const session = (await getAuth().api.getSession({
    headers: headerList,
  })) as Session | null;
  if (session?.user.role !== "admin") {
    return { error: "Only administrators can do this." };
  }
  return { session, headers: headerList };
}

/** Self and last-admin guards, from Better Auth's view of who is an admin. */
async function guard(
  actorId: string,
  userId: string,
  action: "suspend" | "delete",
): Promise<string | null> {
  if (actorId === userId) return `You can't ${action} your own account.`;
  const context = await getAuth().$context;
  const admins = await context.adapter.findMany<{
    id: string;
    banned?: boolean | null;
  }>({ model: "user", where: [{ field: "role", value: "admin" }] });
  const target = admins.some((admin) => admin.id === userId);
  const others = admins.filter((admin) => admin.id !== userId && !admin.banned);
  if (target && others.length === 0) {
    return `You can't ${action} the last administrator.`;
  }
  return null;
}

function authMessage(error: unknown, fallback: string): string {
  if (isAPIError(error) && typeof error.body?.message === "string") {
    return error.body.message;
  }
  return fallback;
}

function backendMessage(error: unknown, fallback: string): string {
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  return typeof detail === "string" ? detail : fallback;
}

export async function suspendAccount(userId: string): Promise<LifecycleResult> {
  const admin = await adminSession();
  if ("error" in admin) return { ok: false, error: admin.error };
  const refused = await guard(admin.session.user.id, userId, "suspend");
  if (refused) return { ok: false, error: refused };

  const api = await getApiClient();
  const backend = await api.userSuspend({ path: { user_id: userId } });
  if (backend.error) {
    return {
      ok: false,
      error: backendMessage(backend.error, "Couldn't suspend this account."),
    };
  }
  try {
    await getAuth().api.banUser({
      headers: admin.headers,
      body: { userId, banReason: "Suspended by an administrator" },
    });
  } catch (error) {
    return {
      ok: false,
      error: `Asterism refuses this account now, but sign-in isn't blocked yet: ${authMessage(error, UNREACHABLE)} Try again.`,
    };
  }
  return { ok: true };
}

export async function reactivateAccount(
  userId: string,
): Promise<LifecycleResult> {
  const admin = await adminSession();
  if ("error" in admin) return { ok: false, error: admin.error };
  try {
    await getAuth().api.unbanUser({
      headers: admin.headers,
      body: { userId },
    });
  } catch (error) {
    return {
      ok: false,
      error: authMessage(error, "Couldn't allow sign-in for this account."),
    };
  }
  const api = await getApiClient();
  const backend = await api.userReactivate({ path: { user_id: userId } });
  if (backend.error) {
    return {
      ok: false,
      error: `Sign-in works again, but Asterism still refuses this account: ${backendMessage(backend.error, UNREACHABLE)} Try again.`,
    };
  }
  return { ok: true };
}

export async function deleteAccount(userId: string): Promise<LifecycleResult> {
  const admin = await adminSession();
  if ("error" in admin) return { ok: false, error: admin.error };
  const refused = await guard(admin.session.user.id, userId, "delete");
  if (refused) return { ok: false, error: refused };

  try {
    await getAuth().api.removeUser({
      headers: admin.headers,
      body: { userId },
    });
  } catch (error) {
    // Already gone: an earlier attempt removed it; finish the backend part.
    if (!(isAPIError(error) && error.status === "NOT_FOUND")) {
      return {
        ok: false,
        error: authMessage(error, "Couldn't delete this account."),
      };
    }
  }
  const api = await getApiClient();
  const backend = await api.userDelete({ path: { user_id: userId } });
  if (backend.error && backend.response?.status !== 404) {
    return {
      ok: false,
      error: `The sign-in account is deleted, but their Asterism data isn't yet: ${backendMessage(backend.error, UNREACHABLE)} Try again.`,
    };
  }
  return { ok: true };
}

/**
 * A one-time password reset link for the admin to copy and send.
 *
 * Writes the same verification record Better Auth's own reset request does;
 * its `/reset-password` endpoint checks the expiry, deletes the record on use
 * and revokes the account's sessions.
 */
export async function issueResetLink(userId: string): Promise<ResetLinkResult> {
  const admin = await adminSession();
  if ("error" in admin) return { ok: false, error: admin.error };
  const context = await getAuth().$context;
  if (!(await context.internalAdapter.findUserById(userId))) {
    return { ok: false, error: "This account no longer exists." };
  }
  // A new link replaces any earlier unused one (US-112.3), so only the link
  // the admin just handed over works.
  await context.adapter.deleteMany({
    model: "verification",
    where: [
      { field: "value", value: userId },
      {
        field: "identifier",
        operator: "starts_with",
        value: "reset-password:",
      },
    ],
  });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_LINK_TTL_SECONDS * 1000);
  await context.internalAdapter.createVerificationValue({
    value: userId,
    identifier: `reset-password:${token}`,
    expiresAt,
  });
  const url = new URL("/reset-password", getFrontendServerConfig().publicUrl);
  url.searchParams.set("token", token);
  return { ok: true, url: url.toString(), expiresAt: expiresAt.toISOString() };
}
