import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "./reset-password-form";

const { resetPassword } = vi.hoisted(() => ({ resetPassword: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { resetPassword } }));

async function submit(password: string, confirm = password) {
  const events = userEvent.setup();
  await events.type(
    screen.getByLabelText("New password", { exact: true }),
    password,
  );
  await events.type(screen.getByLabelText("Confirm new password"), confirm);
  await events.click(screen.getByRole("button", { name: "Set password" }));
}

beforeEach(() => vi.clearAllMocks());

it("checks the password rules and the confirmation before sending", async () => {
  render(<ResetPasswordForm token="t0k" />);
  await submit("Short1!");
  expect(screen.getByRole("alert")).toHaveTextContent("between 8 and 32");
  expect(resetPassword).not.toHaveBeenCalled();
});

it("rejects mismatched passwords", async () => {
  render(<ResetPasswordForm token="t0k" />);
  await submit("Orbital-283!", "Orbital-284!");
  expect(screen.getByRole("alert")).toHaveTextContent("don't match");
  expect(resetPassword).not.toHaveBeenCalled();
});

it("sets the password with the link's token", async () => {
  resetPassword.mockResolvedValue({ data: { status: true }, error: null });
  render(<ResetPasswordForm token="t0k" />);
  await submit("Orbital-283!");
  await waitFor(() =>
    expect(resetPassword).toHaveBeenCalledWith({
      newPassword: "Orbital-283!",
      token: "t0k",
    }),
  );
  expect(
    await screen.findByText("You're signed out on every device.", {
      exact: false,
    }),
  ).toBeInTheDocument();
});

it("explains a used or expired link", async () => {
  resetPassword.mockResolvedValue({
    data: null,
    error: { code: "INVALID_TOKEN", message: "Invalid token" },
  });
  render(<ResetPasswordForm token="used" />);
  await submit("Orbital-283!");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "may have been used already or expired",
  );
});
