import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RESET_LINK_TTL_SECONDS } from "@/lib/auth-core";
import {
  deleteAccount,
  issueResetLink,
  reactivateAccount,
  suspendAccount,
} from "./account-lifecycle";

const mocks = vi.hoisted(() => ({
  session: { user: { id: "root", role: "admin" } } as {
    user: { id: string; role: string };
  } | null,
  admins: [] as { id: string; banned?: boolean | null }[],
  calls: [] as string[],
  getSession: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  removeUser: vi.fn(),
  findUserById: vi.fn(),
  createVerificationValue: vi.fn(),
  deleteMany: vi.fn(),
  userSuspend: vi.fn(),
  userReactivate: vi.fn(),
  userDelete: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/server-config", () => ({
  getFrontendServerConfig: () => ({ publicUrl: "https://asterism.test" }),
}));
vi.mock("@/lib/api-server", () => ({
  getApiClient: async () => ({
    userSuspend: mocks.userSuspend,
    userReactivate: mocks.userReactivate,
    userDelete: mocks.userDelete,
  }),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: mocks.getSession,
      banUser: mocks.banUser,
      unbanUser: mocks.unbanUser,
      removeUser: mocks.removeUser,
    },
    $context: Promise.resolve({
      adapter: {
        findMany: async () => mocks.admins,
        deleteMany: mocks.deleteMany,
      },
      internalAdapter: {
        findUserById: mocks.findUserById,
        createVerificationValue: mocks.createVerificationValue,
      },
    }),
  }),
}));

const record =
  (name: string, result: unknown = {}) =>
  async () => {
    mocks.calls.push(name);
    return result;
  };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls = [];
  mocks.session = { user: { id: "root", role: "admin" } };
  mocks.admins = [{ id: "root" }];
  mocks.getSession.mockImplementation(async () => mocks.session);
  mocks.banUser.mockImplementation(record("ban"));
  mocks.unbanUser.mockImplementation(record("unban"));
  mocks.removeUser.mockImplementation(record("remove"));
  mocks.userSuspend.mockImplementation(
    record("backend suspend", { data: true }),
  );
  mocks.userReactivate.mockImplementation(
    record("backend reactivate", { data: true }),
  );
  mocks.userDelete.mockImplementation(record("backend delete", { data: true }));
});

describe("suspendAccount", () => {
  it("refuses tokens in the backend first, then blocks sign-in", async () => {
    expect(await suspendAccount("ann")).toEqual({ ok: true });
    expect(mocks.calls).toEqual(["backend suspend", "ban"]);
    expect(mocks.banUser.mock.calls[0][0].body.userId).toBe("ann");
  });

  it("reports a ban failure after the backend refused the account", async () => {
    mocks.banUser.mockRejectedValue(
      new APIError("INTERNAL_SERVER_ERROR", { message: "auth down" }),
    );
    const result = await suspendAccount("ann");
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(
      /refuses this account now, but sign-in isn't blocked yet: auth down/,
    );
  });

  it("stops before sign-in changes when the backend refuses", async () => {
    mocks.userSuspend.mockResolvedValue({
      error: { detail: "You can't suspend the last administrator" },
    });
    expect(await suspendAccount("ann")).toEqual({
      ok: false,
      error: "You can't suspend the last administrator",
    });
    expect(mocks.banUser).not.toHaveBeenCalled();
  });

  it("refuses non-admins, the admin's own account and the last admin", async () => {
    mocks.session = { user: { id: "ann", role: "user" } };
    expect(await suspendAccount("bo")).toMatchObject({ ok: false });

    mocks.session = { user: { id: "root", role: "admin" } };
    expect(await suspendAccount("root")).toEqual({
      ok: false,
      error: "You can't suspend your own account.",
    });

    // "other" is the only other admin, and it is already suspended.
    mocks.admins = [{ id: "target" }, { id: "other", banned: true }];
    expect(await suspendAccount("target")).toEqual({
      ok: false,
      error: "You can't suspend the last administrator.",
    });
    expect(mocks.userSuspend).not.toHaveBeenCalled();
  });
});

describe("reactivateAccount", () => {
  it("allows sign-in again, then lifts the backend suspension", async () => {
    expect(await reactivateAccount("ann")).toEqual({ ok: true });
    expect(mocks.calls).toEqual(["unban", "backend reactivate"]);
  });
});

describe("deleteAccount", () => {
  it("deletes the sign-in account first, then the backend data", async () => {
    expect(await deleteAccount("ann")).toEqual({ ok: true });
    expect(mocks.calls).toEqual(["remove", "backend delete"]);
  });

  it("reports a backend failure and finishes on retry", async () => {
    mocks.userDelete.mockResolvedValueOnce({
      error: { detail: "busy" },
      response: { status: 500 },
    });
    const first = await deleteAccount("ann");
    expect(!first.ok && first.error).toMatch(
      /sign-in account is deleted, but their Asterism data isn't yet: busy/,
    );

    // The auth account is gone now; the retry treats that as done.
    mocks.removeUser.mockRejectedValue(
      new APIError("NOT_FOUND", { message: "User not found" }),
    );
    expect(await deleteAccount("ann")).toEqual({ ok: true });
    expect(mocks.userDelete).toHaveBeenCalledTimes(2);
  });

  it("does not touch backend data when the auth deletion fails", async () => {
    mocks.removeUser.mockRejectedValue(
      new APIError("FORBIDDEN", { message: "Not allowed" }),
    );
    expect(await deleteAccount("ann")).toEqual({
      ok: false,
      error: "Not allowed",
    });
    expect(mocks.userDelete).not.toHaveBeenCalled();
  });

  it("refuses the admin's own account", async () => {
    expect(await deleteAccount("root")).toEqual({
      ok: false,
      error: "You can't delete your own account.",
    });
    expect(mocks.removeUser).not.toHaveBeenCalled();
  });
});

describe("issueResetLink", () => {
  it("writes Better Auth's reset record with a one-hour expiry", async () => {
    mocks.findUserById.mockResolvedValue({ id: "ann" });
    const before = Date.now();
    const result = await issueResetLink("ann");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe(
      "https://asterism.test/reset-password",
    );
    const token = url.searchParams.get("token")!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [{ value, identifier, expiresAt }] =
      mocks.createVerificationValue.mock.calls[0];
    expect(value).toBe("ann");
    expect(identifier).toBe(`reset-password:${token}`);
    const ttl = (expiresAt.getTime() - before) / 1000;
    expect(ttl).toBeGreaterThanOrEqual(RESET_LINK_TTL_SECONDS - 1);
    expect(ttl).toBeLessThanOrEqual(RESET_LINK_TTL_SECONDS + 1);
    expect(result.expiresAt).toBe(expiresAt.toISOString());
  });

  it("revokes the account's earlier reset links first", async () => {
    mocks.findUserById.mockResolvedValue({ id: "ann" });
    await issueResetLink("ann");
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      model: "verification",
      where: [
        { field: "value", value: "ann" },
        {
          field: "identifier",
          operator: "starts_with",
          value: "reset-password:",
        },
      ],
    });
    expect(mocks.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createVerificationValue.mock.invocationCallOrder[0],
    );
  });

  it("issues a different token each time", async () => {
    mocks.findUserById.mockResolvedValue({ id: "ann" });
    const first = await issueResetLink("ann");
    const second = await issueResetLink("ann");
    expect(first.ok && second.ok && first.url !== second.url).toBe(true);
  });

  it("refuses non-admins and missing accounts", async () => {
    mocks.findUserById.mockResolvedValue(null);
    expect(await issueResetLink("ghost")).toMatchObject({ ok: false });
    mocks.session = null;
    expect(await issueResetLink("ann")).toMatchObject({ ok: false });
    expect(mocks.createVerificationValue).not.toHaveBeenCalled();
  });
});
