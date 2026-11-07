import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ClassCourse } from "./class-course";

const mocks = vi.hoisted(() => ({ get: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  classCourseGetOptions: () => ({ queryKey: ["course"], queryFn: mocks.get }),
  classCourseApplyMutation: () => ({ mutationFn: mocks.apply }),
}));

const offer = {
  version_number: 2,
  note: "Week two",
  published_at: 1_700_000_000,
  instructions: "Be Socratic.",
  sub_agents: [
    {
      name: "Tutor",
      description: "Asks questions.",
      model_name: "Chat A",
      tools: ["web_search"],
    },
  ],
  files: [{ name: "notes.txt", size: 2048 }],
  current: null,
  changes: [],
};

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClassCourse classId="c1" courseName="Biology" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => vi.clearAllMocks());

it("says when there is no course yet", async () => {
  mocks.get.mockResolvedValue(null);
  setup();
  expect(
    await screen.findByText(/hasn't published a course yet/),
  ).toBeInTheDocument();
});

it("summarises the course and adds the reviewed version", async () => {
  mocks.get.mockResolvedValue(offer);
  const user = setup();
  const section = await screen.findByRole("region", {
    name: "Biology course",
  });
  expect(
    within(section).getByText("Tutor — Chat A, can use web_search"),
  ).toBeInTheDocument();
  expect(within(section).getByText("notes.txt")).toBeInTheDocument();
  expect(within(section).getByText(/Week two/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add course" }));
  await waitFor(() =>
    expect(mocks.apply.mock.calls[0]?.[0]).toEqual({
      path: { class_id: "c1" },
      body: { version_number: 2 },
    }),
  );
});

it("lists what changed and offers the update", async () => {
  mocks.get.mockResolvedValue({
    ...offer,
    current: { version_number: 1, project_id: "p1" },
    changes: [
      { kind: "added", item: "file", name: "week2.txt" },
      { kind: "changed", item: "sub_agent", name: "Tutor" },
      {
        kind: "changed",
        item: "settings",
        name: "Course instructions and settings",
      },
    ],
  });
  setup();
  const changes = await screen.findByRole("list", { name: "What changed" });
  expect(
    within(changes)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "Added file week2.txt",
    "Updated sub-agent Tutor",
    "Course instructions and settings updated",
  ]);
  expect(
    screen.getByRole("button", { name: "Update to version 2" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("link", { name: "Open course project" }),
  ).toHaveAttribute("href", "/projects/p1");
});

it("shows the project link when up to date", async () => {
  mocks.get.mockResolvedValue({
    ...offer,
    current: { version_number: 2, project_id: "p1" },
  });
  setup();
  expect(
    await screen.findByText(/You have the latest course/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Update/ })).toBeNull();
});

it("blocks adding when a model isn't available", async () => {
  mocks.get.mockResolvedValue({
    ...offer,
    sub_agents: [{ ...offer.sub_agents[0], model_name: null }],
  });
  setup();
  expect(
    await screen.findByRole("button", { name: "Add course" }),
  ).toBeDisabled();
  expect(screen.getByText(/model isn't available to you/)).toBeInTheDocument();
});
