import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { YourMemorySection } from "./memory-sections";

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  adminSwitches: vi.fn(),
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
});

it("turns memory off for you and explains what that means", async () => {
  const { user } = setup();
  const toggle = screen.getByRole("checkbox", { name: "Use memory" });
  await waitFor(() => expect(toggle).toBeChecked());
  expect(toggle).toHaveAccessibleDescription(/never as instructions/);
  await user.click(toggle);
  expect(mocks.update).toHaveBeenCalledWith("memory_enabled", false, false);
  expect(screen.getByText("Memory list")).toBeInTheDocument();
});

it("says why memory is off, and keeps the list", async () => {
  mocks.adminSwitches.mockResolvedValue(memorySwitch(false));
  mocks.availability.mockResolvedValue({
    available: false,
    off_by: "policy",
    reason: "Your administrator has turned memory off",
  });
  setup();
  const toggle = screen.getByRole("checkbox", { name: "Use memory" });
  expect(toggle).toBeDisabled();
  expect(toggle).not.toBeChecked();
  expect(
    await screen.findByText(
      /Your administrator has turned memory off\. Your saved memories are kept/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Memory list")).toBeInTheDocument();
});

it("enables Use memory when the admin turns memory on, without a reload", async () => {
  mocks.adminSwitches.mockResolvedValue(memorySwitch(false));
  const { queryClient } = setup();
  const toggle = screen.getByRole("checkbox", { name: "Use memory" });
  await waitFor(() => expect(mocks.adminSwitches).toHaveBeenCalled());
  expect(toggle).toBeDisabled();

  // An admin policy save invalidates the availability query (EPIC-96).
  mocks.adminSwitches.mockResolvedValue(memorySwitch(true));
  await queryClient.invalidateQueries({
    queryKey: [{ _id: "availabilityGet" }],
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).toBeChecked();
});
