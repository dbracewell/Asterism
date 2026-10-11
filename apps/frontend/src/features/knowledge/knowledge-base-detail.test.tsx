import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ApiClient } from "@/lib/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KnowledgeBaseDetail } from "./knowledge-base-detail";

const { api, client } = vi.hoisted(() => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
  api: {
    fileGetMany: vi.fn(),
    fileGetFileInfo: vi.fn(),
    fileKnowledgeGetStatus: vi.fn(),
    fileUpload: vi.fn(),
    knowledgeBaseFileCreate: vi.fn(),
    knowledgeBaseFileDeleteMany: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({ client }));

function renderDetail() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <TooltipProvider>
        <KnowledgeBaseDetail knowledgeBaseId="base-1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const libraryFile = {
  id: "file-1",
  filename: "notes.txt",
  original_name: "notes.txt",
  size: 5,
  kind: "text",
  mime_type: "text/plain",
  content_status: "ready",
  knowledge_base_count: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  // The same endpoint serves the library picker and the knowledge-base explorer.
  api.fileGetMany.mockImplementation(async () => ({
    data: { files: [libraryFile], total: 1 },
  }));
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: { status: "ready", caption: { status: null, text: null } },
  });
});

it("lists member files in the explorer and removes only the membership", async () => {
  api.knowledgeBaseFileDeleteMany.mockResolvedValue({ data: { files: [] } });
  renderDetail();
  const user = userEvent.setup();
  expect(api.fileGetMany).toHaveBeenCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ knowledge_base_id: "base-1" }),
    }),
  );
  await user.click(await screen.findByRole("button", { name: /notes\.txt/ }));
  expect(
    screen.queryByRole("button", { name: "Delete selected files" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: "Remove selected files from knowledge base",
    }),
  );
  await user.click(await screen.findByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(api.knowledgeBaseFileDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { knowledge_base_id: "base-1" },
        body: { file_ids: ["file-1"] },
      }),
    ),
  );
});

it("adds an existing library file as a membership without ingestion", async () => {
  api.knowledgeBaseFileCreate.mockResolvedValue({
    data: { id: "membership-1" },
  });
  renderDetail();
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "notes.txt" });
  await user.selectOptions(
    await screen.findByLabelText("Uploaded file"),
    "file-1",
  );
  const addButton = screen.getByRole("button", { name: "Add existing file" });
  await waitFor(() => expect(addButton).toBeEnabled());
  await user.click(addButton);
  await waitFor(() =>
    expect(api.knowledgeBaseFileCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { knowledge_base_id: "base-1" },
        body: { file_id: "file-1" },
      }),
    ),
  );
});

it("uploads files into the library then adds memberships", async () => {
  api.fileUpload.mockResolvedValue({
    data: { files: [{ id: "file-1" }, { id: "file-2" }] },
  });
  api.knowledgeBaseFileCreate.mockResolvedValue({ data: {} });
  renderDetail();
  fireEvent.change(await screen.findByLabelText("Upload knowledge files"), {
    target: {
      files: [new File(["one"], "one.txt"), new File(["two"], "two.txt")],
    },
  });
  await waitFor(() =>
    expect(api.knowledgeBaseFileCreate).toHaveBeenCalledTimes(2),
  );
  expect(api.knowledgeBaseFileCreate).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      path: { knowledge_base_id: "base-1" },
      body: { file_id: "file-1" },
    }),
  );
});
