import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { TaughtClass } from "@/lib/client";
import { turnOff } from "@/test/availability";
import { ClassModePolicy } from "./class-mode-policy";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/features/availability/queries", () => import("@/test/availability"));
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

beforeEach(() => {
  vi.clearAllMocks();
  turnOff();
});

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
      body: {
        allowed_modes: ["tutor"],
        answer_reveal: false,
        memory_enabled: true,
        study_chat_enabled: true,
      },
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

it("turns memory off for the course and shows the saved setting", async () => {
  const user = setup();
  const memory = await screen.findByRole("switch", {
    name: "Let Asterism use students' memories in this course",
  });
  expect(memory).toBeChecked();
  expect(memory).toHaveAccessibleDescription(
    /You never see their memories either way/,
  );
  await user.click(memory);
  await user.click(screen.getByRole("button", { name: "Save policy" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      path: { class_id: "c1" },
      body: {
        allowed_modes: null,
        answer_reveal: true,
        memory_enabled: false,
        study_chat_enabled: true,
      },
    }),
  );
});

it("starts from a course that already has memory off", async () => {
  setup({ memory_enabled: false });
  expect(
    await screen.findByRole("switch", {
      name: "Let Asterism use students' memories in this course",
    }),
  ).not.toBeChecked();
});

it("hides the memory switch while the admin has memory off, and keeps its value", async () => {
  turnOff("course_memory");
  const user = setup({ memory_enabled: false });
  await screen.findByRole("checkbox", { name: "Standard" });
  expect(
    screen.queryByRole("switch", { name: /students' memories/ }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save policy" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0].body.memory_enabled).toBe(false),
  );
});

it("turns decks and quizzes from chat off for the course (EPIC-98)", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("switch", {
      name: "Let students make decks and quizzes from chat",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Save policy" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0].body.study_chat_enabled).toBe(false),
  );
});

it("hides that switch while the admin has study in chat off for everyone", async () => {
  turnOff("course_study_chat");
  setup({ study_chat_enabled: false });
  await screen.findByRole("checkbox", { name: "Standard" });
  expect(
    screen.queryByRole("switch", { name: /decks and quizzes/ }),
  ).toBeNull();
});
