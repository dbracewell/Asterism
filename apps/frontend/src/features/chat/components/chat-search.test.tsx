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
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ChatSearch />
    </QueryClientProvider>,
  );

beforeEach(() => search.mockReset());

it("shows matching chats with their snippet and project membership", async () => {
  search.mockResolvedValue({
    results: [
      {
        kind: "chat",
        id: "chat-1",
        title: "Ocean currents",
        snippet: "Explain ocean circulation",
        project_id: "project-1",
        project_name: "Research",
        match_source: "content",
        updated_at: 1,
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
  });
  renderSearch();

  await userEvent
    .setup()
    .type(screen.getByLabelText("Search chats and projects"), "ocean");

  expect(await screen.findByText("Ocean currents")).toBeInTheDocument();
  expect(screen.getByText("Research")).toBeInTheDocument();
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
  const input = screen.getByLabelText("Search chats and projects");
  await userEvent.setup().type(input, "nothing");
  expect(await screen.findByText("No matches found")).toBeInTheDocument();

  await userEvent.setup().clear(input);
  await userEvent.setup().type(input, "failure");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to search"),
  );
});

it("labels project description matches and General chats", async () => {
  search.mockResolvedValue({
    results: [
      {
        kind: "project",
        id: "project-1",
        title: "Research",
        snippet: "Ocean studies",
        match_source: "project_description",
      },
      {
        kind: "chat",
        id: "chat-1",
        title: "Ocean notes",
        project_name: null,
        snippet: "Ocean notes",
        match_source: "title",
      },
    ],
    total: 2,
    page: 1,
    page_size: 20,
  });
  renderSearch();
  await userEvent
    .setup()
    .type(screen.getByLabelText("Search chats and projects"), "ocean");
  expect(await screen.findByText("Project description")).toBeInTheDocument();
  expect(screen.getByText("General")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Research/ })).toHaveAttribute(
    "href",
    "/projects/project-1",
  );
});
