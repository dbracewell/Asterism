import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { SkillsPolicySettings } from "./skills-policy-settings";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  role: "admin",
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "admin", role: mocks.role }),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  skillsPolicyGetOptions: () => ({
    queryKey: [{ _id: "policy" }],
    queryFn: () => mocks.get(),
  }),
  skillsPolicyGetQueryKey: () => [{ _id: "policy" }],
  skillsPolicyUpdateMutation: () => ({ mutationFn: mocks.save }),
  skillEligibleGetManyQueryKey: () => [{ _id: "eligible" }],
  chatSessionGetOneQueryKey: () => [{ _id: "chat" }],
}));
function setup() {
  const cache: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, m) => handleMutationSuccess(cache, m),
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <SkillsPolicySettings />
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  mocks.role = "admin";
  mocks.get.mockReset().mockResolvedValue({ enabled: false });
  mocks.save.mockReset().mockImplementation(async ({ body }) => {
    mocks.get.mockResolvedValue(body);
    return body;
  });
});
it("loads disabled policy, saves only a boolean, and invalidates discovery and chats", async () => {
  const cache = setup();
  cache.setQueryData([{ _id: "eligible", owner: "user" }], {
    policy_enabled: false,
  });
  cache.setQueryData([{ _id: "chat", chat: "one" }], {});
  const user = userEvent.setup();
  const toggle = await screen.findByRole("switch", {
    name: "Enable skill activation",
  });
  expect(toggle).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Save skill policy" }),
  ).toBeDisabled();
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save skill policy" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Skill policy saved."),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    { body: { enabled: true } },
    expect.anything(),
  );
  expect(toggle).toBeChecked();
  expect(
    cache.getQueryState([{ _id: "eligible", owner: "user" }])?.isInvalidated,
  ).toBe(true);
  expect(
    cache.getQueryState([{ _id: "chat", chat: "one" }])?.isInvalidated,
  ).toBe(true);
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save skill policy" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenLastCalledWith(
      { body: { enabled: false } },
      expect.anything(),
    ),
  );
});
it("retains pending selection after a denied save and permits retry", async () => {
  mocks.save.mockRejectedValueOnce({ detail: "Administrator access denied" });
  setup();
  const user = userEvent.setup();
  const toggle = await screen.findByRole("switch", {
    name: "Enable skill activation",
  });
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save skill policy" }));
  await screen.findByText("Administrator access denied");
  expect(toggle).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save skill policy" }));
  await screen.findByText("Skill policy saved.");
});
it("offers load retry and does not guess disabled policy on error", async () => {
  mocks.get.mockRejectedValueOnce(new Error("Offline"));
  setup();
  await screen.findByText("Skill policy could not be loaded.");
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  await screen.findByRole("switch", { name: "Enable skill activation" });
});
it("does not read or mutate administrator policy for an ordinary user", async () => {
  mocks.role = "user";
  setup();
  await screen.findByText(
    "Administrator access is required to manage skill activation.",
  );
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
});
it("raises the sticky save bar only while the policy differs from the saved value", async () => {
  setup();
  const user = userEvent.setup();
  const toggle = await screen.findByRole("switch", {
    name: "Enable skill activation",
  });
  const status = screen.getByRole("status");
  const bar = status.closest('[data-slot="settings-save-bar"]');
  expect(bar).not.toHaveAttribute("data-dirty");
  expect(status).not.toHaveTextContent("Unsaved changes");

  await user.click(toggle);
  expect(bar).toHaveAttribute("data-dirty");
  expect(status).toHaveTextContent("Unsaved changes");
  expect(
    screen.getByRole("button", { name: "Save skill policy" }),
  ).toBeEnabled();

  await user.click(toggle);
  expect(bar).not.toHaveAttribute("data-dirty");
  expect(status).not.toHaveTextContent("Unsaved changes");

  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save skill policy" }));
  await waitFor(() => expect(status).toHaveTextContent("Skill policy saved."));
  expect(bar).not.toHaveAttribute("data-dirty");
});
