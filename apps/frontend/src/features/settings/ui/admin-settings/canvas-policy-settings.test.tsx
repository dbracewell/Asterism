import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { CanvasPolicySettings } from "./canvas-policy-settings";

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
  canvasPolicyGetOptions: () => ({
    queryKey: [{ _id: "canvas-policy" }],
    queryFn: () => mocks.get(),
  }),
  canvasPolicyGetQueryKey: () => [{ _id: "canvas-policy" }],
  canvasPolicyUpdateMutation: () => ({ mutationFn: mocks.save }),
}));

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <CanvasPolicySettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.role = "admin";
  mocks.get.mockReset().mockResolvedValue({ enabled: false });
  mocks.save.mockReset().mockImplementation(async ({ body }) => body);
});

it("starts off and saves the canvas policy", async () => {
  setup();
  const user = userEvent.setup();
  const toggle = await screen.findByRole("switch", { name: "Enable canvas" });
  expect(toggle).not.toBeChecked();
  const save = screen.getByRole("button", { name: "Save canvas policy" });
  expect(save).toBeDisabled();
  await user.click(toggle);
  await user.click(save);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Canvas policy saved.",
    ),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    { body: { enabled: true } },
    expect.anything(),
  );
});

it("is for administrators only", () => {
  mocks.role = "user";
  setup();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Administrator access is required to manage the canvas.",
  );
});
