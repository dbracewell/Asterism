import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseUserSchema } from "@/features/auth/schemas";
import { decideSignupRole, hashMatch } from "@/lib/auth-core";
import { installApp, signUpWithInvite } from "./actions";
import { INVALID_INVITE } from "./invites";
import { clearSignupLimits, inviteTokenLimiter } from "./signup-limit";

const { countMock, deleteUserMock, signUpEmailMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  deleteUserMock: vi.fn(),
  signUpEmailMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/api-server", () => ({
  getApiClient: vi.fn(),
}));

vi.mock("@/lib/server-config", () => ({
  getFrontendServerConfig: () => ({
    systemKey: "test-system-key",
  }),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      signUpEmail: signUpEmailMock,
      getSession: vi.fn(),
    },
    $context: Promise.resolve({
      adapter: {
        count: countMock,
      },
      internalAdapter: {
        deleteUser: deleteUserMock,
      },
    }),
  }),
}));

describe("BaseUserSchema password validation", () => {
  it("rejects all-lowercase and all-uppercase passwords", () => {
    expect(
      BaseUserSchema.safeParse({
        name: "User",
        email: "user@example.test",
        password: "alllowercase123!",
      }).success,
    ).toBe(false);

    expect(
      BaseUserSchema.safeParse({
        name: "User",
        email: "user@example.test",
        password: "ALLUPPERCASE123!",
      }).success,
    ).toBe(false);

    expect(
      BaseUserSchema.safeParse({
        name: "User",
        email: "user@example.test",
        password: "MixedCase123!",
      }).success,
    ).toBe(true);
  });
});

describe("hashMatch", () => {
  it("rejects empty passphrases and mismatched candidates", () => {
    expect(hashMatch("", "")).toBe(false);
    expect(hashMatch("", "valid-passphrase")).toBe(false);
    expect(hashMatch("valid-passphrase", "")).toBe(false);
    expect(hashMatch(undefined, "valid-passphrase")).toBe(false);
    expect(hashMatch("wrong", "valid-passphrase")).toBe(false);
  });

  it("accepts matching non-empty passphrases", () => {
    expect(hashMatch("valid-passphrase", "valid-passphrase")).toBe(true);
  });
});

describe("installApp", () => {
  const validPayload = {
    name: "Admin User",
    email: "admin@example.test",
    password: "ValidPassword123!",
    adminKey: "secret-passphrase",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    clearSignupLimits();
  });

  it("limits install attempts from one address", async () => {
    countMock.mockResolvedValue(1);
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(installApp(validPayload)).rejects.toThrow(
        "Application is already installed",
      );
    }
    await expect(installApp(validPayload)).rejects.toThrow(
      "Too many sign-up attempts. Try again in a few minutes.",
    );
    expect(countMock).toHaveBeenCalledTimes(10);
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("rejects installation when at least one user already exists", async () => {
    countMock.mockResolvedValueOnce(1);

    await expect(installApp(validPayload)).rejects.toThrow(
      "Application is already installed",
    );
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("provisions the backend user with their name and email", async () => {
    countMock.mockResolvedValueOnce(0);
    signUpEmailMock.mockResolvedValueOnce({
      token: "jwt-token",
      user: { id: "user-123", name: "Admin", email: "admin@example.test" },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await installApp(validPayload);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      user_id: "user-123",
      name: "Admin",
      email: "admin@example.test",
      system_key: "test-system-key",
    });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("rolls back the BetterAuth user when backend provisioning fails", async () => {
    countMock.mockResolvedValueOnce(0);
    signUpEmailMock.mockResolvedValueOnce({
      token: "jwt-token",
      user: { id: "user-123" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: "Backend database unavailable" }),
      }),
    );

    await expect(installApp(validPayload)).rejects.toThrow(
      "Backend database unavailable",
    );
    expect(deleteUserMock).toHaveBeenCalledWith("user-123");
  });
});

describe("decideSignupRole", () => {
  const base = {
    query: {},
    sessionRole: undefined,
    requestedRole: undefined,
    adminPassphrase: "admin-pass",
    systemKey: "system-key",
    installed: false,
  };

  it("needs the admin key or a signed-in admin", () => {
    expect(() => decideSignupRole(base)).toThrow("Invalid admin key");
    expect(
      decideSignupRole({ ...base, query: { adminKey: "admin-pass" } }),
    ).toBe("admin");
    expect(decideSignupRole({ ...base, sessionRole: "admin" })).toBe("user");
    expect(
      decideSignupRole({
        ...base,
        sessionRole: "admin",
        requestedRole: "admin",
      }),
    ).toBe("admin");
  });

  it("needs the system key with the admin key once installed", () => {
    const installed = { ...base, installed: true };
    expect(() =>
      decideSignupRole({ ...installed, query: { adminKey: "admin-pass" } }),
    ).toThrow("Invalid admin key");
    expect(() =>
      decideSignupRole({
        ...installed,
        query: { adminKey: "admin-pass", systemKey: "guess" },
      }),
    ).toThrow("Invalid admin key");
    expect(
      decideSignupRole({
        ...installed,
        query: { adminKey: "admin-pass", systemKey: "system-key" },
      }),
    ).toBe("admin");
    expect(
      decideSignupRole({
        ...installed,
        query: {
          adminKey: "admin-pass",
          systemKey: "system-key",
          role: "user",
        },
      }),
    ).toBe("user");
    // A signed-in administrator still needs no key.
    expect(decideSignupRole({ ...installed, sessionRole: "admin" })).toBe(
      "user",
    );
  });

  it("makes invite signups ordinary users, and only with the system key", () => {
    expect(
      decideSignupRole({
        ...base,
        query: { inviteToken: "t", systemKey: "system-key", role: "admin" },
        requestedRole: "admin",
      }),
    ).toBe("user");
    expect(() =>
      decideSignupRole({
        ...base,
        query: { inviteToken: "t", systemKey: "guess" },
      }),
    ).toThrow("Invalid admin key");
  });
});

describe("signUpWithInvite", () => {
  const payload = {
    token: "invite-token",
    name: "Student",
    email: "student@example.test",
    password: "ValidPassword123!",
  };
  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });
  const refused = { ok: false, status: 400, json: async () => ({}) };
  const preview = { class_name: "Biology", educator_name: "Dr T" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    clearSignupLimits();
    countMock.mockResolvedValue(1);
  });

  it("creates an ordinary account and claims the invite", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(preview))
      .mockResolvedValueOnce(ok(preview));
    vi.stubGlobal("fetch", fetchMock);
    signUpEmailMock.mockResolvedValueOnce({
      user: {
        id: "new-user",
        name: "Student",
        email: "student@example.test",
      },
    });

    await expect(signUpWithInvite(payload)).resolves.toEqual({
      ok: true,
      className: "Biology",
    });
    expect(signUpEmailMock.mock.calls[0]?.[0].query).toEqual({
      inviteToken: "invite-token",
      systemKey: "test-system-key",
    });
    const redeemBody = JSON.parse(fetchMock.mock.calls[1]?.[1].body);
    expect(redeemBody).toEqual({
      token: "invite-token",
      user_id: "new-user",
      display_name: "Student",
      email: "student@example.test",
      system_key: "test-system-key",
    });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("refuses before setup without creating an account", async () => {
    countMock.mockResolvedValueOnce(0);
    vi.stubGlobal("fetch", vi.fn());
    await expect(signUpWithInvite(payload)).resolves.toEqual({
      ok: false,
      error: "Asterism hasn't been set up yet.",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("refuses an unusable invite without creating an account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(refused));
    await expect(signUpWithInvite(payload)).resolves.toEqual({
      ok: false,
      error: INVALID_INVITE,
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("deletes the new account when the claim fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(ok(preview)).mockResolvedValueOnce(refused),
    );
    signUpEmailMock.mockResolvedValueOnce({
      user: { id: "loser", name: "Student", email: "student@example.test" },
    });
    await expect(signUpWithInvite(payload)).resolves.toEqual({
      ok: false,
      error: INVALID_INVITE,
    });
    expect(deleteUserMock).toHaveBeenCalledWith("loser");
  });

  it("lets a class of 30 on one network join, then limits the address", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused));
    for (let student = 0; student < 60; student++) {
      await expect(
        signUpWithInvite({ ...payload, token: `invite-${student}` }),
      ).resolves.toEqual({ ok: false, error: INVALID_INVITE });
    }
    await expect(
      signUpWithInvite({ ...payload, token: "invite-61" }),
    ).resolves.toEqual({
      ok: false,
      error: "Too many sign-up attempts. Try again in a few minutes.",
    });
  });

  it("limits attempts on one invite", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused));
    for (let attempt = 0; attempt < 5; attempt++) {
      await signUpWithInvite(payload);
    }
    await expect(signUpWithInvite(payload)).resolves.toEqual({
      ok: false,
      error: "Too many sign-up attempts. Try again in a few minutes.",
    });
    // Another student's invite from the same network still works.
    expect(inviteTokenLimiter.attempt("another-invite")).toBe(true);
  });
});
