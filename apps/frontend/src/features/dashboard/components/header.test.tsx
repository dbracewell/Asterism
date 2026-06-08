import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock, refreshMock, signOutMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: signOutMock,
  },
}));

import { Header } from "@/features/dashboard/components/header";

describe("Header", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    refreshMock.mockReset();
    signOutMock.mockReset();
    signOutMock.mockResolvedValue({});
  });

  it("signs out and redirects to home", async () => {
    render(<Header />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(replaceMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});
