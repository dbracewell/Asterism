import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ApiClient } from "@/lib/client";
import { KnowledgeBaseDetail } from "./knowledge-base-detail";

const { api, client } = vi.hoisted(() => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
  api: {
    knowledgeBaseFileGetMany: vi.fn(),
    fileGetMany: vi.fn(),
    fileUpload: vi.fn(),
    knowledgeBaseFileCreate: vi.fn(),
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
      <KnowledgeBaseDetail knowledgeBaseId="base-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.knowledgeBaseFileGetMany.mockResolvedValue({ data: { files: [] } });
  api.fileGetMany.mockResolvedValue({
    data: {
      files: [
        {
          id: "file-1",
          original_name: "notes.txt",
          mime_type: "text/plain",
          content_status: "ready",
        },
      ],
    },
  });
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
