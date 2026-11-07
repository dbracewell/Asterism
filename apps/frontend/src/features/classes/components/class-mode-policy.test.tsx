import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { TaughtClass } from "@/lib/client";
import { ClassModePolicy } from "./class-mode-policy";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  learningModeGetManyOptions: () => ({
    queryKey: ["modes"],
    queryFn: async () => ({
      modes: [
        { id: "standard", name: "Standard", description: "", version: 1 },
        { id: "tutor", name: "Tutor", description: "", version: 2 },
      ],
    }),
  }),
  classModePolicyUpdateMutation: () => ({ mutationFn: mocks.save }),
}));

const item = {
  id: "c1",
  name: "Biology",
  allowed_modes: null,
  answer_reveal: true,
} as unknown as TaughtClass;

function setup(overrides: Partial<TaughtClass> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClassModePolicy item={{ ...item, ...overrides }} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => vi.clearAllMocks());

it("narrows the allowed modes and turns reveals off", async () => {
  const user = setup();
  await user.click(await screen.findByRole("checkbox", { name: "Standard" }));
  await user.click(
    screen.getByRole("switch", {
      name: "Let students reveal answers and solutions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Save policy" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      path: { class_id: "c1" },
      body: { allowed_modes: ["tutor"], answer_reveal: false },
    }),
  );
});

it("saves no limit when every mode is allowed", async () => {
  const user = setup({ allowed_modes: ["tutor"] });
  await user.click(await screen.findByRole("checkbox", { name: "Standard" }));
  await user.click(screen.getByRole("button", { name: "Save policy" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0].body.allowed_modes).toBeNull(),
  );
});

it("needs at least one mode", async () => {
  const user = setup({ allowed_modes: ["tutor"] });
  await user.click(await screen.findByRole("checkbox", { name: "Tutor" }));
  expect(screen.getByText("Allow at least one mode.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();
});
