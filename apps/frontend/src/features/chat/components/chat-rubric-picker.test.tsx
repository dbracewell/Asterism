import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { RubricUse } from "@/lib/client";
import { ChatRubricPicker } from "./chat-rubric-picker";

const mocks = vi.hoisted(() => ({
  bundled: vi.fn(),
  list: vi.fn(),
  changed: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", async (original) => {
  const key = (_id: string, options?: object) => [{ _id, ...options }];
  return {
    ...(await original()),
    rubricBundledGetManyOptions: () => ({
      queryKey: key("rubricBundledGetMany"),
      queryFn: mocks.bundled,
    }),
    rubricGetManyOptions: ({ query }: { query: object }) => ({
      queryKey: key("rubricGetMany", { query }),
      queryFn: () => mocks.list(query),
    }),
  };
});

const doc = { name: "", description: "", levels: [], criteria: [] };

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.bundled.mockResolvedValue({
    version: 1,
    items: [
      {
        id: "lab-report",
        revision: 1,
        name: "Lab report",
        description: "Science labs.",
        document: doc,
      },
    ],
  });
  mocks.list.mockResolvedValue({
    items: [
      {
        id: "r1",
        name: "History essay",
        description: "Mr. Lee",
        revision: 1,
        created_at: 1,
        updated_at: 1,
      },
    ],
    total: 1,
    page: 1,
    page_size: 100,
  });
});

function Controlled({ initial }: { initial: RubricUse | null }) {
  const [value, setValue] = useState(initial);
  return (
    <ChatRubricPicker
      owner="owner"
      value={value}
      onChange={(next) => {
        setValue(next);
        mocks.changed(next);
      }}
    />
  );
}

function setup(initial: RubricUse | null = null) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <Controlled initial={initial} />
    </QueryClientProvider>,
  );
}

it("offers no rubric, bundled rubrics and the owner's rubrics", async () => {
  const user = userEvent.setup();
  setup();
  const selector = screen.getByRole("combobox", { name: "Rubric" });
  await waitFor(() => expect(selector).toBeEnabled());
  expect(selector).toHaveTextContent("No rubric");
  expect(mocks.list).toHaveBeenCalledWith({ page: 1, page_size: 100 });
  await user.click(selector);
  expect(screen.getByRole("group", { name: "Bundled" })).toBeVisible();
  expect(screen.getByRole("group", { name: "Your rubrics" })).toBeVisible();
  await user.click(screen.getByRole("option", { name: "History essay" }));
  expect(mocks.changed).toHaveBeenLastCalledWith({ source: "owned", id: "r1" });
  expect(selector).toHaveTextContent("History essay");
  await user.click(selector);
  await user.click(screen.getByRole("option", { name: "Lab report" }));
  expect(mocks.changed).toHaveBeenLastCalledWith({
    source: "bundled",
    id: "lab-report",
  });
  await user.click(selector);
  await user.click(screen.getByRole("option", { name: "No rubric" }));
  expect(mocks.changed).toHaveBeenLastCalledWith(null);
});

it("shows a deleted selection as unavailable", async () => {
  setup({ source: "owned", id: "gone" });
  const selector = screen.getByRole("combobox", { name: "Rubric" });
  await waitFor(() => expect(selector).toBeEnabled());
  expect(selector).toHaveTextContent("Unavailable rubric");
});
