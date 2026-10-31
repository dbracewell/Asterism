import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatGptConnectionSettings } from "./chatgpt-connection-settings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  authorize: vi.fn(),
  disconnect: vi.fn(),
  sync: vi.fn(),
  callback: null as string | null,
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "user-a", role: "user" }),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/hooks/use-read-write-search-params", () => ({
  useReadWriteSearchParams: () => ({
    getSearchParam: (name: string) =>
      name === "chatgpt" ? mocks.callback : null,
  }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatgptConnectionGetOptions: () => ({
    queryKey: [{ _id: "chatgptConnectionGet" }],
    queryFn: () => mocks.get(),
  }),
  chatgptConnectionAuthorizeMutation: () => ({ mutationFn: mocks.authorize }),
  chatgptConnectionDisconnectMutation: () => ({ mutationFn: mocks.disconnect }),
  chatgptPlanModelsSyncMutation: () => ({ mutationFn: mocks.sync }),
}));

const assign = vi.fn();

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ChatGptConnectionSettings />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  mocks.callback = null;
  mocks.get.mockReset().mockResolvedValue({
    policy_enabled: true,
    status: null,
    email: null,
    plan_usage_enabled: false,
  });
  mocks.authorize.mockReset().mockResolvedValue({
    authorization_url: "https://auth.openai.com/api/accounts/authorize?x=1",
  });
  mocks.disconnect.mockReset();
  mocks.sync.mockReset();
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
});

it("starts sign-in with Continue with ChatGPT and states the same-machine limit", async () => {
  const user = setup();
  await screen.findByText("Not connected.");
  expect(
    screen.getByText(/this browser must run on the same machine as Asterism/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Disconnect" }),
  ).not.toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "Continue with ChatGPT" }),
  );

  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/authorize?x=1",
    ),
  );
});

it("disables connecting when the administrator policy is off but keeps the connection", async () => {
  mocks.get.mockResolvedValue({
    policy_enabled: false,
    status: "plan_usage_disabled",
    email: "plan@example.test",
    plan_usage_enabled: false,
  });
  setup();
  await screen.findByText(
    /Your administrator has turned off ChatGPT plan connections. Your connection is kept/,
  );
  expect(
    screen.getByRole("button", { name: "Continue with ChatGPT" }),
  ).toBeDisabled();
});

it("shows the connected account and disconnects after confirmation", async () => {
  mocks.get.mockResolvedValue({
    policy_enabled: true,
    status: "connected",
    email: "plan@example.test",
    plan_usage_enabled: true,
  });
  mocks.disconnect.mockResolvedValue({
    revocation_confirmed: false,
    connection: { policy_enabled: true, status: "disconnected" },
  });
  const user = setup();
  await screen.findByText("Connected as plan@example.test");
  expect(screen.getByText("Plan usage on")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Continue with ChatGPT" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Disconnect" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

  await waitFor(() =>
    expect(mocks.disconnect).toHaveBeenCalledWith(
      { body: { forget: false } },
      expect.anything(),
    ),
  );
  expect(
    await screen.findByText(/ChatGPT did not confirm the session ended/),
  ).toBeInTheDocument();
});

it("forgets the account to switch to a different one", async () => {
  mocks.get.mockResolvedValue({
    policy_enabled: true,
    status: "reauthorization_required",
    email: "plan@example.test",
    plan_usage_enabled: false,
  });
  mocks.disconnect.mockResolvedValue({
    revocation_confirmed: true,
    connection: { policy_enabled: true, status: null },
  });
  const user = setup();
  await screen.findByText(/Your ChatGPT session ended. Sign in again/);
  expect(
    screen.getByRole("button", { name: "Continue with ChatGPT" }),
  ).toBeEnabled();

  await user.click(
    screen.getByRole("button", { name: "Use a different account" }),
  );
  const dialog = await screen.findByRole("alertdialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Forget account" }),
  );

  await waitFor(() =>
    expect(mocks.disconnect).toHaveBeenCalledWith(
      { body: { forget: true } },
      expect.anything(),
    ),
  );
});

it.each([
  ["connected", "status", "Your ChatGPT plan is connected."],
  ["denied", "alert", "ChatGPT sign-in was cancelled."],
  ["account_mismatch", "alert", /different ChatGPT account/],
  ["plan_usage_disabled", "alert", /did not allow plan usage/],
])("reports the %s callback outcome", async (outcome, role, text) => {
  mocks.callback = outcome;
  setup();
  await screen.findByText("Not connected.");
  expect(
    screen
      .getAllByRole(role)
      .some((node) =>
        typeof text === "string"
          ? node.textContent === text
          : text.test(node.textContent ?? ""),
      ),
  ).toBe(true);
});

it("offers retry and shows no actions when the connection cannot load", async () => {
  mocks.get.mockRejectedValueOnce(new Error("Offline"));
  setup();
  await screen.findByText("ChatGPT connection could not be loaded.");
  expect(
    screen.queryByRole("button", { name: "Continue with ChatGPT" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  await screen.findByText("Not connected.");
});

it("shows the plan model count and refreshes models from the account", async () => {
  mocks.get.mockResolvedValue({
    policy_enabled: true,
    status: "connected",
    email: "plan@example.test",
    plan_usage_enabled: true,
    model_count: 2,
  });
  mocks.sync.mockRejectedValueOnce({
    detail: "ChatGPT plan models could not be loaded; try again later",
  });
  const user = setup();
  await screen.findByText("2 plan models available.");

  await user.click(screen.getByRole("button", { name: "Refresh models" }));

  await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByText(
      "ChatGPT plan models could not be loaded; try again later",
    ),
  ).toBeInTheDocument();
});

it("hides plan models until plan usage is connected", async () => {
  mocks.get.mockResolvedValue({
    policy_enabled: true,
    status: "plan_usage_disabled",
    email: "plan@example.test",
    plan_usage_enabled: false,
    model_count: 0,
  });
  setup();
  await screen.findByText("Plan usage disabled");
  expect(
    screen.queryByRole("button", { name: "Refresh models" }),
  ).not.toBeInTheDocument();
});
