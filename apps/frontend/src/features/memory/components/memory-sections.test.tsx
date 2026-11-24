import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { YourMemorySection } from "./memory-sections";

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  adminSwitches: vi.fn(),
  saved: vi.fn(),
  update: vi.fn(),
  settings: { memory_enabled: true },
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "a", settings: mocks.settings }),
}));
vi.mock("@/features/settings/hooks/use-update-user-settings", () => ({
  useUpdateUserSettings: () => ({
    updateSetting: mocks.update,
    isUpdatingUserSetting: false,
  }),
}));
vi.mock("./memory-list", () => ({ MemoryList: () => <p>Memory list</p> }));
vi.mock("@/features/help/components/help-topic", () => ({
  HelpTopic: () => null,
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  memoryAvailabilityOptions: () => ({
    queryKey: [{ _id: "memoryAvailability" }],
    queryFn: () => mocks.availability(),
  }),
  memoryGetManyOptions: () => ({
    queryKey: [{ _id: "memoryGetMany" }],
    queryFn: () => mocks.saved(),
  }),
  availabilityGetOptions: () => ({
    queryKey: [{ _id: "availabilityGet" }],
    queryFn: () => mocks.adminSwitches(),
  }),
  availabilityGetQueryKey: () => [{ _id: "availabilityGet" }],
}));

const memorySwitch = (available: boolean) => ({
  memory: { available, reason: available ? "" : "Off" },
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <YourMemorySection />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = { memory_enabled: true };
  mocks.availability.mockResolvedValue({ available: true });
  mocks.adminSwitches.mockResolvedValue(memorySwitch(true));
  mocks.saved.mockResolvedValue({ items: [], total: 0 });
});

it("turns memory off for you and explains what that means", async () => {
  const { user } = setup();
  const toggle = await screen.findByRole("checkbox", { name: "Use memory" });
  expect(toggle).toBeChecked();
  expect(toggle).toHaveAccessibleDescription(/never as instructions/);
  await user.click(toggle);
  expect(mocks.update).toHaveBeenCalledWith("memory_enabled", false, false);
  expect(screen.getByText("Memory list")).toBeInTheDocument();
});

it("hides the setting while memory is off, and keeps saved memories reachable", async () => {
  mocks.adminSwitches.mockResolvedValue(memorySwitch(false));
  mocks.saved.mockResolvedValue({ items: [], total: 1 });
  mocks.availability.mockResolvedValue({
    available: false,
    off_by: "policy",
    reason: "Your administrator has turned memory off",
  });
  setup();
  expect(
    await screen.findByText(
      /Your administrator has turned memory off\. Your saved memories are kept/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Memory list")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "Use memory" })).toBeNull();
});

it("shows no Memory section while memory is off and nothing is saved", async () => {
  mocks.adminSwitches.mockResolvedValue(memorySwitch(false));
  setup();
  await waitFor(() => expect(mocks.saved).toHaveBeenCalled());
  expect(screen.queryByText("Memory list")).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Use memory" })).toBeNull();
});

it("shows Use memory when the admin turns memory on, without a reload", async () => {
  mocks.adminSwitches.mockResolvedValue(memorySwitch(false));
  const { queryClient } = setup();
  await waitFor(() => expect(mocks.adminSwitches).toHaveBeenCalled());
  expect(screen.queryByRole("checkbox", { name: "Use memory" })).toBeNull();

  // An admin policy save invalidates the availability query (EPIC-96).
  mocks.adminSwitches.mockResolvedValue(memorySwitch(true));
  await queryClient.invalidateQueries({
    queryKey: [{ _id: "availabilityGet" }],
  });
  const toggle = await screen.findByRole("checkbox", { name: "Use memory" });
  expect(toggle).toBeEnabled();
  expect(toggle).toBeChecked();
});
