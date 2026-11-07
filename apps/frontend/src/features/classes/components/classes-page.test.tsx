import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ClassesPage } from "./classes-page";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  taught: vi.fn(),
  joined: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  create: vi.fn(),
  request: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  educatorAccessGetOptions: () => ({
    queryKey: ["access"],
    queryFn: mocks.access,
  }),
  classGetManyOptions: () => ({ queryKey: ["taught"], queryFn: mocks.taught }),
  classJoinedGetManyOptions: () => ({
    queryKey: ["joined"],
    queryFn: mocks.joined,
  }),
  classJoinMutation: () => ({ mutationFn: mocks.join }),
  classLeaveMutation: () => ({ mutationFn: mocks.leave }),
  classCreateMutation: () => ({ mutationFn: mocks.create }),
  educatorAccessRequestMutation: () => ({ mutationFn: mocks.request }),
  classCourseGetOptions: () => ({
    queryKey: ["course"],
    queryFn: async () => null,
  }),
  classCourseApplyMutation: () => ({ mutationFn: vi.fn() }),
}));

const page = (items: object[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 100,
});

function setup(initialCode = "") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClassesPage initialCode={initialCode} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ status: "none" });
  mocks.taught.mockResolvedValue(page([]));
  mocks.joined.mockResolvedValue(page([]));
  mocks.join.mockResolvedValue({ name: "Biology" });
  mocks.request.mockResolvedValue({ status: "pending" });
  mocks.create.mockResolvedValue({ id: "c1" });
});

it("joins with a code and says the educator sees the student's name", async () => {
  const user = setup();
  expect(screen.getByText(/can't see your chats/)).toBeInTheDocument();
  await user.type(screen.getByLabelText("Class code"), "ABCD");
  await user.click(screen.getByRole("button", { name: "Join class" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "You joined Biology",
  );
  expect(mocks.join.mock.calls[0][0]).toEqual({ body: { code: "ABCD" } });
});

it("prefills the code from a join link", () => {
  setup("LINKCODE");
  expect(screen.getByLabelText("Class code")).toHaveValue("LINKCODE");
});

it("shows why a code was refused", async () => {
  mocks.join.mockRejectedValue({ detail: "That class code isn't valid." });
  const user = setup();
  await user.type(screen.getByLabelText("Class code"), "NOPE");
  await user.click(screen.getByRole("button", { name: "Join class" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("isn't valid");
});

it("lists joined classes, who runs them, and lets a student leave", async () => {
  mocks.joined.mockResolvedValue(
    page([
      { id: "c1", name: "Biology", description: "", educator_name: "Dr T" },
    ]),
  );
  const user = setup();
  expect(await screen.findByText("Run by Dr T")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Leave Biology" }));
  await waitFor(() =>
    expect(mocks.leave.mock.calls[0][0]).toEqual({
      path: { class_id: "c1" },
    }),
  );
});

it("offers educator access and says what is shared", async () => {
  const user = setup();
  const ask = await screen.findByRole("button", {
    name: "Request educator access",
  });
  expect(screen.getByText(/sends your name and email/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create class" }),
  ).not.toBeInTheDocument();
  await user.click(ask);
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
});

it("says when a request is waiting", async () => {
  mocks.access.mockResolvedValue({ status: "pending" });
  setup();
  expect(await screen.findByText(/waiting for an admin/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Create class" }),
  ).not.toBeInTheDocument();
});

it("lets an approved educator create a class and opens it", async () => {
  mocks.access.mockResolvedValue({ status: "approved" });
  mocks.taught.mockResolvedValue(
    page([{ id: "c0", name: "Chemistry", member_count: 1 }]),
  );
  const user = setup();
  expect(
    await screen.findByRole("link", { name: "Chemistry" }),
  ).toHaveAttribute("href", "/classes/c0");
  expect(screen.getByText("1 student")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Class name"), "Biology");
  await user.click(screen.getByRole("button", { name: "Create class" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/classes/c1"));
});
