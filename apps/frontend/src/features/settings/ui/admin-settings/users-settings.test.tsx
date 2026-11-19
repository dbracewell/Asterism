import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { UserContext } from "@/features/auth/components/user-context";
import type { User } from "@/features/auth/types";
import { UsersSettings } from "./users-settings";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  move: vi.fn(),
  dismiss: vi.fn(),
  suspend: vi.fn(),
  reactivate: vi.fn(),
  remove: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/auth/server/account-lifecycle", () => ({
  suspendAccount: mocks.suspend,
  reactivateAccount: mocks.reactivate,
  deleteAccount: mocks.remove,
  issueResetLink: mocks.reset,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  userGetManyOptions: (options: { query: Record<string, unknown> }) => ({
    queryKey: ["users", options.query],
    queryFn: () => mocks.list(options.query),
  }),
  groupGetManyOptions: () => ({
    queryKey: ["groups"],
    queryFn: async () =>
      [
        ["admin", "Admin"],
        ["educator", "Educator"],
        ["student", "Student"],
        ["night", "Night school"],
      ].map(([id, name]) => ({ id, name })),
  }),
  groupMemberMoveMutation: () => ({ mutationFn: mocks.move }),
  userDeletionRequestDismissMutation: () => ({ mutationFn: mocks.dismiss }),
}));

const GROUPS = {
  admin: { id: "admin", name: "Admin" },
  educator: { id: "educator", name: "Educator" },
  student: { id: "student", name: "Student" },
};

const user = (
  id: string,
  name: string | null,
  educator: "pending" | "approved" | null = null,
  group: keyof typeof GROUPS = educator === "approved" ? "educator" : "student",
) => ({
  id,
  name,
  email: name ? `${id}@example.test` : null,
  educator,
  group: GROUPS[group],
  created_at: 1_700_000_000,
  suspended: false,
  deletion_requested_at: null as number | null,
});

function page(items: ReturnType<typeof user>[], total = items.length) {
  return { items, total, page: 1, page_size: 50 };
}

function setup(selfId?: string) {
  render(
    <UserContext.Provider
      value={{ user: selfId ? ({ id: selfId } as User) : null }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <UsersSettings />
      </QueryClientProvider>
    </UserContext.Provider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(
    page([
      user("ann", "Ann", "approved"),
      user("bo", "Bo", "pending"),
      user("u-3", null),
      user("root", "Root", null, "admin"),
    ]),
  );
});

it("lists names, emails, groups, educator requests and the first-seen date", async () => {
  setup();
  expect(await screen.findByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("ann@example.test")).toBeInTheDocument();
  expect(
    await screen.findByRole("combobox", { name: "Group for Ann" }),
  ).toHaveTextContent("Educator");
  expect(
    screen.getByRole("combobox", { name: "Group for Bo" }),
  ).toHaveTextContent("Student");
  expect(screen.getByText("Educator request")).toBeInTheDocument();
  // No name or email yet: the id stands in.
  expect(screen.getByText("Unnamed user")).toBeInTheDocument();
  expect(screen.getByText("u-3")).toBeInTheDocument();
  // Administrators follow the sign-in role, so their group can't be chosen.
  expect(
    screen.queryByRole("combobox", { name: "Group for Root" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Admin")).toBeInTheDocument();
  expect(screen.getAllByText(/^First seen /)).toHaveLength(4);
  expect(screen.getByText("Page 1 · 4 users")).toBeInTheDocument();
});

it("moves a user to another group, never into Admin", async () => {
  mocks.move.mockResolvedValue({ id: "night", name: "Night school" });
  const actor = setup();
  await actor.click(
    await screen.findByRole("combobox", { name: "Group for Bo" }),
  );
  expect(
    screen.queryByRole("option", { name: "Admin" }),
  ).not.toBeInTheDocument();
  await actor.click(screen.getByRole("option", { name: "Night school" }));
  await waitFor(() =>
    expect(mocks.move.mock.calls[0][0]).toEqual({
      path: { user_id: "bo" },
      body: { group_id: "night" },
    }),
  );
});

it("searches from the first page and says when nothing matches", async () => {
  const actor = setup();
  await screen.findByText("Ann");
  mocks.list.mockResolvedValue(page([]));
  await actor.type(
    screen.getByRole("searchbox", { name: "Search users" }),
    " zed ",
  );
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith({
      search: "zed",
      page: 1,
      page_size: 50,
    }),
  );
  expect(await screen.findByText("No matching users")).toBeInTheDocument();
});

it("pages through long lists", async () => {
  mocks.list.mockResolvedValue(page([user("ann", "Ann")], 120));
  const actor = setup();
  await actor.click(await screen.findByRole("button", { name: "Next users" }));
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith({
      search: undefined,
      page: 2,
      page_size: 50,
    }),
  );
  expect(await screen.findByText("Page 2 · 120 users")).toBeInTheDocument();
});

it("offers a retry when the list cannot load", async () => {
  mocks.list.mockRejectedValue(new Error("down"));
  setup();
  expect(await screen.findByText("Could not load users.")).toBeInTheDocument();
});

it("says a signed-in non-admin is not allowed (US-90.1)", async () => {
  mocks.list.mockRejectedValue({
    code: 403,
    detail: "Only an administrator can do this",
  });
  setup();
  expect(await screen.findByText("Could not load users.")).toBeInTheDocument();
  expect(
    screen.getByText("Only an administrator can do this"),
  ).toBeInTheDocument();
});

// --- US-86.2: account lifecycle -------------------------------------------

it("hides account actions on the admin's own row", async () => {
  setup("root");
  expect(await screen.findByText("Root")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Account actions for Root" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Account actions for Ann" }),
  ).toBeInTheDocument();
});

it("suspends after confirmation and reactivates a suspended account", async () => {
  mocks.list.mockResolvedValue(
    page([user("ann", "Ann"), { ...user("bo", "Bo"), suspended: true }]),
  );
  mocks.suspend.mockResolvedValue({ ok: true });
  mocks.reactivate.mockResolvedValue({ ok: true });
  const events = setup("root");

  await events.click(
    await screen.findByRole("button", { name: "Account actions for Ann" }),
  );
  await events.click(screen.getByRole("menuitem", { name: "Suspend" }));
  expect(
    screen.getByRole("alertdialog", { name: "Suspend Ann?" }),
  ).toHaveTextContent("Nothing is deleted");
  expect(mocks.suspend).not.toHaveBeenCalled();
  await events.click(screen.getByRole("button", { name: "Suspend" }));
  await waitFor(() => expect(mocks.suspend).toHaveBeenCalledWith("ann"));
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );

  expect(screen.getByText("Suspended")).toBeInTheDocument();
  await events.click(
    screen.getByRole("button", { name: "Account actions for Bo" }),
  );
  await events.click(screen.getByRole("menuitem", { name: "Reactivate" }));
  await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith("bo"));
});

it("names what deletion removes and offers a retry after a partial failure", async () => {
  mocks.list.mockResolvedValue(page([user("ann", "Ann")]));
  mocks.remove.mockResolvedValueOnce({
    ok: false,
    error:
      "The sign-in account is deleted, but their Asterism data isn't yet: down Try again.",
  });
  mocks.remove.mockResolvedValueOnce({ ok: true });
  const events = setup("root");

  await events.click(
    await screen.findByRole("button", { name: "Account actions for Ann" }),
  );
  await events.click(screen.getByRole("menuitem", { name: "Delete account" }));
  const dialog = screen.getByRole("alertdialog", {
    name: "Delete Ann's account?",
  });
  expect(dialog).toHaveTextContent("can't be undone");
  expect(dialog).toHaveTextContent("any class they teach is deleted");
  await events.click(screen.getByRole("button", { name: "Delete account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "sign-in account is deleted",
  );
  await events.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
});

it("shows a password reset link once", async () => {
  mocks.list.mockResolvedValue(page([user("ann", "Ann")]));
  mocks.reset.mockResolvedValue({
    ok: true,
    url: "https://asterism.test/reset-password?token=abc",
    expiresAt: "2026-11-17T20:00:00.000Z",
  });
  const events = setup("root");

  await events.click(
    await screen.findByRole("button", { name: "Account actions for Ann" }),
  );
  await events.click(
    screen.getByRole("menuitem", { name: "Create password reset link" }),
  );
  expect(
    await screen.findByRole("textbox", { name: "Password reset link" }),
  ).toHaveValue("https://asterism.test/reset-password?token=abc");
  expect(screen.getByRole("dialog")).toHaveTextContent("It works once");
  await events.click(screen.getByRole("button", { name: "Done" }));
  expect(
    screen.queryByRole("textbox", { name: "Password reset link" }),
  ).not.toBeInTheDocument();
});

it("shows an open deletion request and dismisses it", async () => {
  mocks.list.mockResolvedValue(
    page([{ ...user("ann", "Ann"), deletion_requested_at: 1_700_000_000 }]),
  );
  mocks.dismiss.mockResolvedValue(true);
  const events = setup("root");

  expect(await screen.findByText(/Asked for deletion/)).toBeInTheDocument();
  await events.click(
    screen.getByRole("button", { name: "Dismiss Ann's deletion request" }),
  );
  await waitFor(() =>
    expect(mocks.dismiss.mock.calls[0][0]).toEqual({
      path: { user_id: "ann" },
    }),
  );
});
