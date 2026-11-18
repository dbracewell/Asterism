import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AccountLifecycleSettings } from "./account-lifecycle-settings";

const mocks = vi.hoisted(() => ({
  role: { current: "user" },
  get: vi.fn(),
  create: vi.fn(),
  withdraw: vi.fn(),
  revokeSessions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { revokeSessions: mocks.revokeSessions },
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ role: mocks.role.current }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  userDeletionRequestGetOptions: () => ({
    queryKey: ["deletion-request"],
    queryFn: mocks.get,
  }),
  userDeletionRequestCreateMutation: () => ({ mutationFn: mocks.create }),
  userDeletionRequestWithdrawMutation: () => ({ mutationFn: mocks.withdraw }),
}));

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountLifecycleSettings />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.current = "user";
  mocks.get.mockResolvedValue({ requested_at: null });
});

it("asks for deletion only after confirmation", async () => {
  mocks.create.mockResolvedValue({ requested_at: 1_700_000_000 });
  const events = setup();
  await events.click(
    await screen.findByRole("button", { name: "Ask to delete my account" }),
  );
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "An administrator sees your request and decides",
  );
  expect(mocks.create).not.toHaveBeenCalled();
  await events.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
});

it("shows an open request and withdraws it", async () => {
  mocks.get.mockResolvedValue({ requested_at: 1_700_000_000 });
  mocks.withdraw.mockResolvedValue({ requested_at: null });
  const events = setup();
  expect(
    await screen.findByText(/You asked for your account to be deleted/),
  ).toBeInTheDocument();
  await events.click(screen.getByRole("button", { name: "Withdraw request" }));
  await waitFor(() => expect(mocks.withdraw).toHaveBeenCalled());
});

it("offers administrators no deletion request", async () => {
  mocks.role.current = "admin";
  setup();
  expect(
    screen.getByRole("button", { name: "Sign out everywhere" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Ask to delete my account" }),
  ).not.toBeInTheDocument();
  expect(mocks.get).not.toHaveBeenCalled();
});

it("reports a failed sign out everywhere", async () => {
  mocks.revokeSessions.mockResolvedValue({ error: { message: "Offline" } });
  const events = setup();
  await events.click(
    screen.getByRole("button", { name: "Sign out everywhere" }),
  );
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "including this one",
  );
  await events.click(
    screen.getByRole("button", { name: "Sign out everywhere" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
});
