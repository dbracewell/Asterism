import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ClassDetail } from "./class-detail";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  members: vi.fn(),
  rotate: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  allow: vi.fn(),
  deleteClass: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  classGetOneOptions: () => ({ queryKey: ["class"], queryFn: mocks.get }),
  classMemberGetManyOptions: () => ({
    queryKey: ["members"],
    queryFn: mocks.members,
  }),
  classJoinCodeRotateMutation: () => ({ mutationFn: mocks.rotate }),
  classUpdateMutation: () => ({ mutationFn: mocks.update }),
  classMemberRemoveMutation: () => ({ mutationFn: mocks.remove }),
  classMemberAllowBackMutation: () => ({ mutationFn: mocks.allow }),
  classDeleteMutation: () => ({ mutationFn: mocks.deleteClass }),
  classInviteGetManyOptions: () => ({
    queryKey: ["invites"],
    queryFn: async () => ({ items: [], total: 0, page: 1, page_size: 100 }),
  }),
  classInviteCreateMutation: () => ({ mutationFn: vi.fn() }),
  classInviteRevokeMutation: () => ({ mutationFn: vi.fn() }),
  projectGetManyOptions: () => ({
    queryKey: ["projects"],
    queryFn: async () => ({ projects: [], total: 0, page: 1, page_size: 100 }),
  }),
  classCourseVersionGetManyOptions: () => ({
    queryKey: ["versions"],
    queryFn: async () => ({ items: [], total: 0, page: 1, page_size: 20 }),
  }),
  classCoursePublishMutation: () => ({ mutationFn: vi.fn() }),
  learningModeGetManyOptions: () => ({
    queryKey: ["modes"],
    queryFn: async () => ({ modes: [] }),
  }),
  classModePolicyUpdateMutation: () => ({ mutationFn: vi.fn() }),
  classInsightsGetOptions: () => ({
    queryKey: ["insights"],
    queryFn: async () => ({
      min_group_size: 5,
      consenting_students: 0,
      topics: [],
      hidden_topics: 0,
    }),
  }),
}));

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClassDetail classId="c1" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    id: "c1",
    name: "Biology",
    description: "Cells",
    join_code: "ABCD234567",
    join_enabled: true,
    member_count: 1,
  });
  mocks.members.mockResolvedValue({
    items: [
      { user_id: "s1", display_name: "Ann", removed_at: null, created_at: 1 },
      { user_id: "s2", display_name: "Bo", removed_at: 5, created_at: 1 },
    ],
    total: 2,
    page: 1,
    page_size: 100,
  });
});

it("shows the code and turns joining off", async () => {
  const user = setup();
  expect(await screen.findByLabelText("Class code")).toHaveTextContent(
    "ABCD234567",
  );
  await user.click(
    screen.getByRole("switch", { name: "Allow new students to join" }),
  );
  await waitFor(() =>
    expect(mocks.update.mock.calls[0][0]).toEqual({
      path: { class_id: "c1" },
      body: { join_enabled: false },
    }),
  );
});

it("replaces the code", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Replace code" }));
  await waitFor(() => expect(mocks.rotate).toHaveBeenCalled());
});

it("removes a student, and allows a removed one back", async () => {
  const user = setup();
  expect(await screen.findByText(/never students' chats/)).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Remove Ann" }));
  await waitFor(() =>
    expect(mocks.remove.mock.calls[0][0]).toEqual({
      path: { class_id: "c1", student_id: "s1" },
    }),
  );
  expect(screen.getByText("Bo (removed)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Allow Bo back" }));
  await waitFor(() => expect(mocks.allow).toHaveBeenCalled());
});

it("confirms before deleting a class", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Delete class" }));
  expect(mocks.deleteClass).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Their own chats and files");
  await user.click(
    screen.getAllByRole("button", { name: "Delete class" }).at(-1)!,
  );
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/classes"));
});

it("does not reveal another educator's class", async () => {
  mocks.get.mockRejectedValue({ detail: "Class not found" });
  setup();
  expect(
    await screen.findByText("This class isn't available."),
  ).toBeInTheDocument();
});
