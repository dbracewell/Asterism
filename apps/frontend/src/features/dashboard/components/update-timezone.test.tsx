import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateTimeZone } from "./update-timezone";
import type { User } from "@/features/auth/types";

const mockUpdateUser = vi.fn();
let mockUser: User;

vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => mockUser,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  },
}));

describe("UpdateTimeZone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call updateUser when user timezone matches the browser timezone", () => {
    const currentTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    mockUser = {
      id: "u-1",
      name: "Test User",
      email: "test@example.com",
      role: "user",
      timezone: currentTz,
      settings: {} as User["settings"],
    };

    render(<UpdateTimeZone />);

    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("calls updateUser when user timezone differs from the browser timezone", () => {
    const currentTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    mockUser = {
      id: "u-1",
      name: "Test User",
      email: "test@example.com",
      role: "user",
      timezone: "Differing/Timezone",
      settings: {} as User["settings"],
    };

    render(<UpdateTimeZone />);

    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledWith({ timezone: currentTz });
  });
});
