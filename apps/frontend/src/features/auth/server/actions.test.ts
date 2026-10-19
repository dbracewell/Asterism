import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseUserSchema } from "@/features/auth/schemas";
import { matchesAdminPassphrase } from "@/lib/auth-core";
import { installApp } from "./actions";

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

describe("matchesAdminPassphrase", () => {
  it("rejects empty passphrases and mismatched candidates", () => {
    expect(matchesAdminPassphrase("", "")).toBe(false);
    expect(matchesAdminPassphrase("", "valid-passphrase")).toBe(false);
    expect(matchesAdminPassphrase("valid-passphrase", "")).toBe(false);
    expect(matchesAdminPassphrase(undefined, "valid-passphrase")).toBe(false);
    expect(matchesAdminPassphrase("wrong", "valid-passphrase")).toBe(false);
  });

  it("accepts matching non-empty passphrases", () => {
    expect(matchesAdminPassphrase("valid-passphrase", "valid-passphrase")).toBe(
      true,
    );
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
  });

  it("rejects installation when at least one user already exists", async () => {
    countMock.mockResolvedValueOnce(1);

    await expect(installApp(validPayload)).rejects.toThrow(
      "Application is already installed",
    );
    expect(signUpEmailMock).not.toHaveBeenCalled();
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
