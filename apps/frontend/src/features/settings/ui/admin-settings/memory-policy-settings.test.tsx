import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryPolicySettings } from "./memory-policy-settings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  groups: vi.fn(),
  role: "admin",
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "admin", role: mocks.role }),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  memoryPolicyGetOptions: () => ({
    queryKey: [{ _id: "memory-policy" }],
    queryFn: () => mocks.get(),
  }),
  memoryPolicyGetQueryKey: () => [{ _id: "memory-policy" }],
  memoryPolicyUpdateMutation: () => ({ mutationFn: mocks.save }),
  memoryAvailabilityQueryKey: () => [{ _id: "memory-availability" }],
  userSettingsGetQueryKey: () => [{ _id: "user-settings" }],
  groupGetManyOptions: () => ({
    queryKey: [{ _id: "groups" }],
    queryFn: () => mocks.groups(),
  }),
}));

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryPolicySettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.role = "admin";
  mocks.get.mockReset().mockResolvedValue({ enabled: false, group_ids: null });
  mocks.save.mockReset().mockImplementation(async ({ body }) => body);
  mocks.groups.mockReset().mockResolvedValue([
    { id: "educator", name: "Educators" },
    { id: "student", name: "Students" },
  ]);
});

it("is for administrators only", () => {
  mocks.role = "user";
  setup();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Administrator access is required to manage memory.",
  );
});

it("starts off and turns memory on for every group", async () => {
  setup();
  const user = userEvent.setup();
  const toggle = await screen.findByRole("switch", { name: "Enable memory" });
  expect(toggle).not.toBeChecked();
  const save = screen.getByRole("button", { name: "Save availability" });
  expect(save).toBeDisabled();
  await user.click(toggle);
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  await user.click(save);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Availability saved."),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    { body: { enabled: true, group_ids: null } },
    expect.anything(),
  );
});

it("limits memory to the chosen groups and reports save errors", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("switch", { name: "Enable memory" }),
  );
  await user.click(
    screen.getByRole("switch", { name: "Limit to selected groups" }),
  );
  const groups = await screen.findByRole("list", {
    name: "Groups allowed to use memory",
  });
  expect(groups).toBeInTheDocument();
  await user.click(await screen.findByRole("checkbox", { name: "Students" }));
  mocks.save.mockRejectedValueOnce(new Error("Unknown groups: student"));
  await user.click(screen.getByRole("button", { name: "Save availability" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unknown groups: student",
  );
  expect(mocks.save).toHaveBeenCalledWith(
    { body: { enabled: true, group_ids: ["student"] } },
    expect.anything(),
  );
});
