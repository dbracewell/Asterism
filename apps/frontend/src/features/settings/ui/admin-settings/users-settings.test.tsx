import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { UsersSettings } from "./users-settings";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  userGetManyOptions: (options: { query: Record<string, unknown> }) => ({
    queryKey: ["users", options.query],
    queryFn: () => mocks.list(options.query),
  }),
}));

const user = (
  id: string,
  name: string | null,
  educator: "pending" | "approved" | null = null,
) => ({
  id,
  name,
  email: name ? `${id}@example.test` : null,
  educator,
  created_at: 1_700_000_000,
});

function page(items: ReturnType<typeof user>[], total = items.length) {
  return { items, total, page: 1, page_size: 50 };
}

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UsersSettings />
    </QueryClientProvider>,
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
    ]),
  );
});

it("lists names, emails, educator status and the first-seen date", async () => {
  setup();
  expect(await screen.findByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("ann@example.test")).toBeInTheDocument();
  expect(screen.getByText("Educator")).toBeInTheDocument();
  expect(screen.getByText("Educator request")).toBeInTheDocument();
  // No name or email yet: the id stands in.
  expect(screen.getByText("Unnamed user")).toBeInTheDocument();
  expect(screen.getByText("u-3")).toBeInTheDocument();
  expect(screen.getAllByText(/^First seen /)).toHaveLength(3);
  expect(screen.getByText("Page 1 · 3 users")).toBeInTheDocument();
  // Read-only: the only buttons page through the list.
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Previous users",
    "Next users",
  ]);
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
