import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { parseLabels, StudentInvites } from "./student-invites";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  classInviteGetManyOptions: () => ({
    queryKey: ["invites"],
    queryFn: mocks.list,
  }),
  classInviteCreateMutation: () => ({ mutationFn: mocks.create }),
  classInviteRevokeMutation: () => ({ mutationFn: mocks.revoke }),
}));

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StudentInvites classId="c1" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    items: [
      {
        id: "i1",
        label: "Ann",
        status: "used",
        expires_at: 2_000_000_000,
        created_at: 1_700_000_000,
        redeemed_at: 1_700_000_100,
        redeemed_name: "Ann Lee",
      },
      {
        id: "i2",
        label: "Bo",
        status: "unused",
        expires_at: 2_000_000_000,
        created_at: 1_700_000_000,
        redeemed_at: null,
        redeemed_name: null,
      },
    ],
    total: 2,
    page: 1,
    page_size: 100,
  });
});

it("parses one label per line and enforces the limits", () => {
  expect(parseLabels(" Ann \n\n Bo ")).toEqual({
    labels: ["Ann", "Bo"],
    error: null,
  });
  expect(parseLabels("  \n").error).toMatch(/at least one/);
  expect(parseLabels("x\n".repeat(51)).error).toMatch(/at most 50/);
  expect(parseLabels("x".repeat(81)).error).toMatch(/under 80/);
});

it("shows who used each invite and withdraws an unused one", async () => {
  const user = setup();
  const list = await screen.findByRole("list", { name: "Invites" });
  expect(within(list).getByText(/Ann Lee joined on/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Withdraw invite for Ann" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Withdraw invite for Bo" }),
  );
  await waitFor(() =>
    expect(mocks.revoke.mock.calls[0]?.[0]).toEqual({
      path: { class_id: "c1", invite_id: "i2" },
    }),
  );
});

it("creates invites and shows each link once", async () => {
  mocks.create.mockResolvedValue({
    items: [
      { id: "n1", label: "Cy", token: "tok-1", expires_at: 2_000_000_000 },
      { id: "n2", label: "Di", token: "tok-2", expires_at: 2_000_000_000 },
    ],
  });
  const user = setup();
  await user.type(
    screen.getByLabelText("Student names, one per line"),
    "Cy{enter}Di",
  );
  await user.click(screen.getByRole("button", { name: "Create invites" }));
  const links = await screen.findByRole("group", { name: "New invite links" });
  expect(mocks.create.mock.calls[0]?.[0]).toEqual({
    path: { class_id: "c1" },
    body: { labels: ["Cy", "Di"] },
  });
  expect(within(links).getByText(/\/invite\/tok-1$/)).toBeInTheDocument();
  expect(within(links).getByText(/\/invite\/tok-2$/)).toBeInTheDocument();
  expect(screen.getByLabelText("Student names, one per line")).toHaveValue("");
});

it("refuses an empty list without calling the server", async () => {
  const user = setup();
  await user.click(screen.getByRole("button", { name: "Create invites" }));
  expect(await screen.findByText(/at least one/)).toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
});
