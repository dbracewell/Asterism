import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ApiClient } from "@/lib/client";
import { KnowledgeBaseManager } from "./knowledge-base-manager";

const { api, client } = vi.hoisted(() => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
  api: {
    knowledgeBaseGetMany: vi.fn(),
    knowledgeBaseCreate: vi.fn(),
    knowledgeBaseUpdate: vi.fn(),
    knowledgeBaseDelete: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({ client }));

const renderManager = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeBaseManager />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.knowledgeBaseGetMany.mockResolvedValue({
    data: {
      knowledge_bases: [
        { id: "base-1", name: "Research", description: "Private notes" },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    },
  });
  api.knowledgeBaseCreate.mockResolvedValue({ data: {} });
  api.knowledgeBaseUpdate.mockResolvedValue({ data: {} });
  api.knowledgeBaseDelete.mockResolvedValue({ data: {} });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

it("uses server-side pagination, sorting, and search", async () => {
  const user = userEvent.setup();
  api.knowledgeBaseGetMany.mockResolvedValue({
    data: {
      knowledge_bases: [
        { id: "base-1", name: "Research", description: "Private notes" },
      ],
      total: 51,
      page: 1,
      page_size: 50,
    },
  });
  renderManager();

  await screen.findByRole("link", { name: "Research" });
  expect(api.knowledgeBaseGetMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: { page: 1, page_size: 50, sort_by: "name" },
    }),
  );

  await user.click(
    screen.getByRole("button", { name: "Sort by date created" }),
  );
  await waitFor(() =>
    expect(api.knowledgeBaseGetMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: { page: 1, page_size: 50, sort_by: "created" },
      }),
    ),
  );

  await user.type(screen.getByLabelText("Search knowledge bases"), "notes");
  await waitFor(() =>
    expect(api.knowledgeBaseGetMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: {
          page: 1,
          page_size: 50,
          query: "notes",
          sort_by: "created",
        },
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(api.knowledgeBaseGetMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: {
          page: 2,
          page_size: 50,
          query: "notes",
          sort_by: "created",
        },
      }),
    ),
  );
});

it("creates, edits, and deletes a knowledge base through the generated client", async () => {
  const user = userEvent.setup();
  renderManager();

  expect(await screen.findByRole("link", { name: "Research" })).toHaveAttribute(
    "href",
    "/knowledge/base-1",
  );
  await user.click(
    screen.getByRole("button", { name: "Create knowledge base" }),
  );
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Manual");
  await user.click(
    screen.getByRole("button", { name: "Create knowledge base" }),
  );
  await waitFor(() =>
    expect(api.knowledgeBaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { name: "Manual", description: null },
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Updated research");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(api.knowledgeBaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { knowledge_base_id: "base-1" },
        body: { name: "Updated research", description: "Private notes" },
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Delete Research" }));
  await waitFor(() =>
    expect(api.knowledgeBaseDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { knowledge_base_id: "base-1" },
      }),
    ),
  );
});

it("shows empty and error states", async () => {
  api.knowledgeBaseGetMany.mockResolvedValueOnce({
    data: { knowledge_bases: [], total: 0, page: 1, page_size: 100 },
  });
  const { unmount } = renderManager();
  expect(await screen.findByText(/No knowledge bases yet/)).toBeInTheDocument();
  unmount();

  api.knowledgeBaseGetMany.mockRejectedValueOnce(new Error("offline"));
  renderManager();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load knowledge bases.",
  );
});
