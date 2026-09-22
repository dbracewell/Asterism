import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { KnowledgeBaseManager } from "./knowledge-base-manager";

const { api } = vi.hoisted(() => ({
  api: {
    knowledgeBaseGetMany: vi.fn(),
    knowledgeBaseCreate: vi.fn(),
    knowledgeBaseUpdate: vi.fn(),
    knowledgeBaseDelete: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({ api }));

beforeEach(() => {
  vi.clearAllMocks();
  api.knowledgeBaseGetMany.mockResolvedValue({
    data: {
      knowledge_bases: [{ id: "base-1", name: "Research", description: "Private notes" }],
      total: 1,
      page: 1,
      page_size: 100,
    },
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
});

it("creates, edits, and deletes a knowledge base through the generated client", async () => {
  const user = userEvent.setup();
  render(<KnowledgeBaseManager />);

  expect(await screen.findByRole("link", { name: "Research" })).toHaveAttribute("href", "/knowledge/base-1");
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Manual");
  await user.click(screen.getByRole("button", { name: "Create knowledge base" }));
  await waitFor(() => expect(api.knowledgeBaseCreate).toHaveBeenCalledWith({ body: { name: "Manual", description: null } }));

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Updated research");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(api.knowledgeBaseUpdate).toHaveBeenCalledWith({
    path: { knowledge_base_id: "base-1" },
    body: { name: "Updated research", description: "Private notes" },
  }));

  await user.click(screen.getByRole("button", { name: "Delete Research" }));
  await waitFor(() => expect(api.knowledgeBaseDelete).toHaveBeenCalledWith({ path: { knowledge_base_id: "base-1" } }));
});

it("shows empty and error states", async () => {
  api.knowledgeBaseGetMany.mockResolvedValueOnce({ data: { knowledge_bases: [], total: 0, page: 1, page_size: 100 } });
  const { unmount } = render(<KnowledgeBaseManager />);
  expect(await screen.findByText(/No knowledge bases yet/)).toBeInTheDocument();
  unmount();

  api.knowledgeBaseGetMany.mockRejectedValueOnce(new Error("offline"));
  render(<KnowledgeBaseManager />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load knowledge bases.");
});
