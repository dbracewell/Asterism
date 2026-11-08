import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { GroupSettings } from "./groups-settings";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  groupGetManyOptions: () => ({
    queryKey: ["groups"],
    queryFn: async () => [
      {
        id: "student",
        name: "Student",
        built_in: true,
        member_count: 12,
        models: null,
        tools: null,
      },
      {
        id: "night",
        name: "Night school",
        built_in: false,
        member_count: 0,
        models: ["m1"],
        tools: [],
      },
    ],
  }),
  groupAccessOptionsOptions: () => ({
    queryKey: ["options"],
    queryFn: async () => ({
      models: [
        { id: "m1", name: "Fast", provider_name: "Local", enabled: true },
        { id: "m2", name: "Big", provider_name: "Cloud", enabled: false },
      ],
      tools: [{ name: "web_fetch", description: "Read a page", enabled: true }],
    }),
  }),
  groupCreateMutation: () => ({ mutationFn: mocks.create }),
  groupRenameMutation: () => ({ mutationFn: mocks.rename }),
  groupDeleteMutation: () => ({ mutationFn: mocks.remove }),
  groupAccessUpdateMutation: () => ({ mutationFn: mocks.access }),
}));

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <GroupSettings />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => vi.clearAllMocks());

it("lists groups with members and access, and protects built-in groups", async () => {
  setup();
  const student = await screen.findByRole("listitem", { name: "Student" });
  expect(student).toHaveTextContent("Built-in");
  expect(student).toHaveTextContent("12 members · all models · all tools");
  expect(
    within(student).queryByRole("button", { name: /Delete|Rename/ }),
  ).not.toBeInTheDocument();
  const night = screen.getByRole("listitem", { name: "Night school" });
  expect(night).toHaveTextContent("0 members · 1 model · 0 tools");
  expect(
    within(night).getByRole("button", { name: "Delete Night school" }),
  ).toBeEnabled();
});

it("limits a group to checked models", async () => {
  mocks.access.mockResolvedValue({});
  const actor = setup();
  const student = await screen.findByRole("listitem", { name: "Student" });
  await actor.click(
    within(student).getByRole("button", { name: "Edit access for Student" }),
  );
  const models = within(student).getByRole("radiogroup", { name: "Models" });
  await actor.click(
    within(models).getByRole("radio", { name: "Only the ones checked below" }),
  );
  expect(within(student).getByText(/turned off for everyone/)).toBeVisible();
  await actor.click(within(student).getByRole("checkbox", { name: /Fast/ }));
  await actor.click(
    within(student).getByRole("button", { name: "Save access for Student" }),
  );
  await waitFor(() =>
    expect(mocks.access.mock.calls[0][0]).toEqual({
      path: { group_id: "student" },
      body: { models: ["m1"], tools: null },
    }),
  );
  expect(await within(student).findByRole("status")).toHaveTextContent(
    "Access saved",
  );
});

it("creates, renames and deletes a custom group, showing refusals", async () => {
  mocks.create.mockResolvedValue({});
  mocks.rename.mockResolvedValue({});
  mocks.remove.mockRejectedValue({
    detail: "Move this group's 1 member(s) to another group before deleting it",
  });
  const actor = setup();
  await actor.type(await screen.findByLabelText("New group"), "  Evening  ");
  await actor.click(screen.getByRole("button", { name: "Create group" }));
  await waitFor(() =>
    expect(mocks.create.mock.calls[0][0]).toEqual({
      body: { name: "Evening" },
    }),
  );

  const night = screen.getByRole("listitem", { name: "Night school" });
  await actor.click(within(night).getByRole("button", { name: "Rename" }));
  const name = within(night).getByLabelText("New name for Night school");
  await actor.clear(name);
  await actor.type(name, "Late school");
  await actor.click(within(night).getByRole("button", { name: "Save name" }));
  await waitFor(() =>
    expect(mocks.rename.mock.calls[0][0]).toEqual({
      path: { group_id: "night" },
      body: { name: "Late school" },
    }),
  );

  await actor.click(
    within(night).getByRole("button", { name: "Delete Night school" }),
  );
  await actor.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await within(night).findByRole("alert")).toHaveTextContent(
    "Move this group's 1 member(s)",
  );
});
