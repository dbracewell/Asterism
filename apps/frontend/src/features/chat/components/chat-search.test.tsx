import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatSearch } from "./chat-search";

const { search } = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatSearchOptions: ({ query }: { query: Record<string, unknown> }) => ({
    queryKey: ["chat-search", query],
    queryFn: () => search(query),
  }),
}));

const renderSearch = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatSearch />
    </QueryClientProvider>,
  );

beforeEach(() => search.mockReset());

it("shows matching chats with their snippet and folder path", async () => {
  search.mockResolvedValue({
    results: [
      {
        kind: "chat",
        id: "chat-1",
        title: "Ocean currents",
        snippet: "Explain ocean circulation",
        path: ["Research", "Papers"],
        match_source: "content",
        updated_at: 1,
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
  });
  renderSearch();

  await userEvent.setup().type(
    screen.getByLabelText("Search chats and folders"),
    "ocean",
  );

  expect(await screen.findByText("Ocean currents")).toBeInTheDocument();
  expect(screen.getByText("Research / Papers")).toBeInTheDocument();
  expect(screen.getByText("Chat content")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /ocean currents/i })).toHaveAttribute(
    "href",
    "/c/chat-1",
  );
});

it("shows empty and error search states", async () => {
  search.mockImplementation((query) =>
    query?.q === "failure"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ results: [], total: 0, page: 1, page_size: 20 }),
  );
  renderSearch();
  const input = screen.getByLabelText("Search chats and folders");
  await userEvent.setup().type(input, "nothing");
  expect(await screen.findByText("No matches found.")).toBeInTheDocument();

  await userEvent.setup().clear(input);
  await userEvent.setup().type(input, "failure");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to search"),
  );
});
