import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, signInEmailMock, signUpEmailMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInEmailMock: vi.fn(),
  signUpEmailMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: signInEmailMock },
    signUp: { email: signUpEmailMock },
  },
}));

import { AuthForm } from "@/components/auth-form";

describe("AuthForm", () => {
  beforeEach(() => {
    pushMock.mockReset();
    signInEmailMock.mockReset();
    signUpEmailMock.mockReset();
  });

  it("renders login view by default", () => {
    render(<AuthForm />);

    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("renders signup view when initialView is signup", () => {
    render(<AuthForm initialView="signup" />);

    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("submits login and redirects on success", async () => {
    signInEmailMock.mockImplementation(async (_payload, callbacks) => {
      callbacks?.onRequest?.();
      callbacks?.onSuccess?.();
      return Promise.resolve();
    });

    render(<AuthForm initialView="login" referer="/app" />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Login" }));

    expect(signInEmailMock).toHaveBeenCalledOnce();
    expect(pushMock).toHaveBeenCalledWith("/app");
  });
});
