import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { Memory } from "@/lib/client";
import { MemoryList } from "./memory-list";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  removeAll: vi.fn(),
  search: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.search }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  memoryGetManyOptions: (options: { query: unknown }) => ({
    queryKey: [{ _id: "memoryGetMany", query: options.query }],
    queryFn: () => mocks.list(options.query),
  }),
  memoryGetManyQueryKey: () => [{ _id: "memoryGetMany" }],
  memoryAvailabilityQueryKey: () => [{ _id: "memoryAvailability" }],
  memoryCreateMutation: () => ({ mutationFn: mocks.create }),
  memoryUpdateMutation: () => ({ mutationFn: mocks.update }),
  memoryDeleteMutation: () => ({ mutationFn: mocks.remove }),
  memoryDeleteAllMutation: () => ({ mutationFn: mocks.removeAll }),
}));

function memory(over: Partial<Memory> = {}): Memory {
  return {
    id: "m1",
    kind: "user",
    project_id: null,
    text: "Learns best from worked examples",
    category: "learning",
    sensitive: false,
    saved_by: "person",
    source: {
      chat_id: null,
      message_id: null,
      execution_id: null,
      chat_deleted: false,
    },
    revision: 1,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function page(items: Memory[]) {
  return { items, total: items.length, page: 1, page_size: 100 };
}

function setup(scope: Parameters<typeof MemoryList>[0]["scope"]) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryList scope={scope} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = new URLSearchParams();
  mocks.list.mockResolvedValue(
    page([
      memory(),
      memory({
        id: "m2",
        text: "Uses a screen reader",
        category: "accessibility",
        sensitive: true,
        saved_by: "agent",
        source: {
          chat_id: null,
          message_id: null,
          execution_id: null,
          chat_deleted: true,
        },
      }),
    ]),
  );
  for (const fn of [mocks.create, mocks.update, mocks.remove, mocks.removeAll])
    fn.mockResolvedValue({});
});

it("groups your memories by category and labels sensitive ones", async () => {
  setup({ kind: "user" });
  const learning = await screen.findByRole("region", { name: "How you learn" });
  expect(learning).toHaveTextContent("Learns best from worked examples");
  expect(learning).toHaveTextContent("Added by you");
  const access = screen.getByRole("region", { name: "Accessibility" });
  expect(within(access).getByText("Sensitive")).toBeInTheDocument();
  expect(access).toHaveTextContent("Saved from a chat (chat deleted)");
  expect(mocks.list).toHaveBeenCalledWith({
    kind: "user",
    page: 1,
    page_size: 100,
  });
});

it("lists one project's memories without categories", async () => {
  mocks.list.mockResolvedValue(
    page([
      memory({
        kind: "project",
        project_id: "p1",
        category: null,
        text: "APA citations",
      }),
    ]),
  );
  setup({ kind: "project", projectId: "p1" });
  expect(
    await screen.findByRole("region", { name: "Project memories" }),
  ).toHaveTextContent("APA citations");
  expect(mocks.list).toHaveBeenCalledWith({
    project_id: "p1",
    page: 1,
    page_size: 100,
  });
});

it("adds a memory, and an accessibility memory is always sensitive", async () => {
  const user = setup({ kind: "user" });
  await user.click(await screen.findByRole("button", { name: "Add a memory" }));
  const dialog = screen.getByRole("dialog", { name: "Add a memory" });
  await user.type(
    within(dialog).getByLabelText("Memory"),
    "  Prefers diagrams ",
  );
  expect(within(dialog).getByLabelText("Sensitive")).not.toBeChecked();
  await user.click(within(dialog).getByRole("button", { name: "Add memory" }));
  await waitFor(() =>
    expect(mocks.create.mock.calls[0]?.[0]).toEqual({
      body: {
        kind: "user",
        text: "Prefers diagrams",
        category: "learning",
        sensitive: false,
      },
    }),
  );
});

it("edits with the expected revision and offers a reload on a conflict", async () => {
  mocks.update.mockRejectedValueOnce({ detail: "Memory changed", code: 409 });
  const user = setup({ kind: "user" });
  await user.click(
    await screen.findByRole("button", {
      name: "Edit memory: Learns best from worked examples",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Edit memory" });
  const text = within(dialog).getByLabelText("Memory");
  await user.clear(text);
  await user.type(text, "Learns from diagrams");
  await user.click(within(dialog).getByRole("button", { name: "Save memory" }));
  await waitFor(() =>
    expect(mocks.update.mock.calls[0]?.[0]).toEqual({
      path: { memory_id: "m1" },
      body: {
        text: "Learns from diagrams",
        category: "learning",
        sensitive: false,
        expected_revision: 1,
      },
    }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "This memory changed somewhere else",
  );
  const calls = mocks.list.mock.calls.length;
  await user.click(
    within(dialog).getByRole("button", { name: "Reload memory" }),
  );
  await waitFor(() =>
    expect(mocks.list.mock.calls.length).toBeGreaterThan(calls),
  );
});

it("deletes one memory, and all of them, only after confirming", async () => {
  const user = setup({ kind: "user" });
  await user.click(
    await screen.findByRole("button", {
      name: "Delete memory: Learns best from worked examples",
    }),
  );
  const confirm = screen.getByRole("alertdialog", {
    name: "Delete this memory?",
  });
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", {
      name: "Delete memory: Learns best from worked examples",
    }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Delete memory",
    }),
  );
  await waitFor(() =>
    expect(mocks.remove.mock.calls[0]?.[0]).toEqual({
      path: { memory_id: "m1" },
      query: { expected_revision: 1 },
    }),
  );

  await user.click(screen.getByRole("button", { name: "Delete all" }));
  const all = screen.getByRole("alertdialog", {
    name: "Delete all 2 memories about you?",
  });
  await user.click(within(all).getByRole("button", { name: "Delete all" }));
  await waitFor(() =>
    expect(mocks.removeAll.mock.calls[0]?.[0]).toEqual({
      query: { kind: "user" },
    }),
  );
});

it("starts empty with no delete-all button", async () => {
  mocks.list.mockResolvedValue(page([]));
  setup({ kind: "user" });
  expect(await screen.findByText("No memories yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete all" })).toBeNull();
});

it("focuses the memory a link points at", async () => {
  mocks.search = new URLSearchParams("memory=m2");
  setup({ kind: "user" });
  await waitFor(() =>
    expect(document.getElementById("memory-m2")).toHaveFocus(),
  );
});
