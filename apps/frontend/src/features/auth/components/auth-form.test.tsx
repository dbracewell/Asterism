import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

const { installApp, signIn } = vi.hoisted(() => ({
  installApp: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("@/features/auth/server/actions", () => ({ installApp }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: signIn } },
}));
beforeEach(() => vi.clearAllMocks());
const fillCredentials = () => {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "person@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "Reachability-321!" },
  });
};
it("focuses setup validation errors, including repeated failures, without losing field values", async () => {
  render(<AuthForm view="install" />);
  fillCredentials();
  const submit = screen.getByRole("button", { name: "Sign up" });
  fireEvent.click(submit);
  const summary = await screen.findByRole("alert");
  expect(summary).toHaveFocus();
  expect(summary).toHaveTextContent("Name and Admin Passkey required");
  expect(
    screen.getByRole("form", { name: "Administrator setup" }),
  ).toHaveAttribute("aria-describedby", summary.id);
  submit.focus();
  fireEvent.click(submit);
  expect(summary).toHaveFocus();
  expect(screen.getByLabelText("Email")).toHaveValue("person@example.test");
  expect(installApp).not.toHaveBeenCalled();
});
it("associates the passkey label with its own control", async () => {
  render(<AuthForm view="install" />);
  await userEvent.click(
    screen.getByText("Admin Passkey", { selector: "label" }),
  );
  expect(screen.getByLabelText("Admin Passkey")).toHaveFocus();
  expect(screen.getByLabelText("Name")).not.toHaveFocus();
});
it("focuses a long setup failure and retains editable credentials", async () => {
  installApp.mockRejectedValueOnce(
    new Error("Setup failed: " + "long-message-".repeat(50)),
  );
  render(<AuthForm view="install" />);
  fillCredentials();
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Administrator" },
  });
  fireEvent.change(screen.getByLabelText("Admin Passkey"), {
    target: { value: "wrong-passkey" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
  expect(await screen.findByRole("alert")).toHaveFocus();
  expect(screen.getByRole("alert")).toHaveTextContent("Setup failed:");
  expect(screen.getByLabelText("Admin Passkey")).toHaveValue("wrong-passkey");
  expect(screen.getByRole("button", { name: "Sign up" })).toBeEnabled();
});
it("focuses a rejected login without changing authentication behavior", async () => {
  signIn.mockImplementationOnce(
    async (
      _data: unknown,
      callbacks: { onError: (context: { error: { message: string } }) => void },
    ) => callbacks.onError({ error: { message: "Invalid email or password" } }),
  );
  render(<AuthForm view="login" />);
  fillCredentials();
  fireEvent.click(screen.getByRole("button", { name: "Login" }));
  expect(await screen.findByRole("alert")).toHaveFocus();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Invalid email or password",
  );
  expect(screen.getByRole("button", { name: "Login" })).toBeEnabled();
});
