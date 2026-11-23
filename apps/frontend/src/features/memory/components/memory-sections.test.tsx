import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { YourMemorySection } from "./memory-sections";

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  update: vi.fn(),
  settings: { memory_enabled: true, memory_allowed: true },
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
}));

function setup() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <YourMemorySection />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = { memory_enabled: true, memory_allowed: true };
  mocks.availability.mockResolvedValue({ available: true });
});

it("turns memory off for you and explains what that means", async () => {
  const user = setup();
  const toggle = screen.getByRole("checkbox", { name: "Use memory" });
  expect(toggle).toBeChecked();
  expect(toggle).toHaveAccessibleDescription(/never as instructions/);
  await user.click(toggle);
  expect(mocks.update).toHaveBeenCalledWith("memory_enabled", false, false);
  expect(screen.getByText("Memory list")).toBeInTheDocument();
});

it("says why memory is off, and keeps the list", async () => {
  mocks.settings = { memory_enabled: true, memory_allowed: false };
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
