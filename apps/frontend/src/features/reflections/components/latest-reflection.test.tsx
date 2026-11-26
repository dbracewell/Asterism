import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { LatestReflection } from "./latest-reflection";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "owner" }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  reflectionGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: [{ _id: "reflectionGetMany", query }],
    queryFn: () => mocks.list(query),
  }),
  reflectionGetManyQueryKey: () => [{ _id: "reflectionGetMany" }],
}));

const reflection = (id: string, learned: string, unclear: string) => ({
  id,
  project_id: "proj",
  chat_id: "c1",
  learned,
  unclear,
  revision: 1,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
});

function setup(showAll = vi.fn()) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(<LatestReflection projectId="proj" showAll={showAll} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  return showAll;
}

beforeEach(() => {
  mocks.list.mockReset();
});

it("shows the newest reflection and opens the Reflections tab", async () => {
  mocks.list.mockResolvedValue({
    items: [
      reflection("r2", "Osmosis moves water.", "Tonicity"),
      reflection("r1", "Older.", ""),
    ],
    total: 2,
    page: 1,
    page_size: 10,
  });
  const showAll = setup();
  const latest = await screen.findByRole("region", {
    name: "Latest reflection",
  });
  expect(latest).toHaveTextContent(/^Latest reflection · /);
  expect(latest).toHaveTextContent("What did I learn?Osmosis moves water.");
  expect(latest).toHaveTextContent("Tonicity");
  expect(latest).not.toHaveTextContent("Older.");
  await userEvent.click(
    screen.getByRole("button", { name: "All 2 reflections" }),
  );
  expect(showAll).toHaveBeenCalledOnce();
});

it("names a single reflection's link plainly", async () => {
  mocks.list.mockResolvedValue({
    items: [reflection("r1", "", "Tonicity")],
    total: 1,
    page: 1,
    page_size: 10,
  });
  setup();
  expect(
    await screen.findByRole("button", { name: "Open Reflections" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("What did I learn?")).not.toBeInTheDocument();
});

it("prompts for one when there are none, with no link", async () => {
  mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 });
  setup();
  const latest = await screen.findByRole("region", {
    name: "Latest reflection",
  });
  expect(latest).toHaveTextContent("No reflections yet");
  expect(latest).toHaveTextContent("choose Reflect at the top of the chat");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("stays hidden while loading or after an error", async () => {
  mocks.list.mockRejectedValue({ detail: "Offline" });
  setup();
  await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  expect(
    screen.queryByRole("region", { name: "Latest reflection" }),
  ).not.toBeInTheDocument();
});
