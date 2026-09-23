import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ApiClient } from "@/lib/client";
import { KnowledgeBaseDetail } from "./knowledge-base-detail";

const { api, client } = vi.hoisted(() => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
  api: {
    knowledgeDocumentGetMany: vi.fn(),
    fileGetMany: vi.fn(),
    fileUpload: vi.fn(),
    knowledgeDocumentCreate: vi.fn(),
    knowledgeDocumentIngest: vi.fn(),
    knowledgeDocumentDelete: vi.fn(),
    knowledgeDocumentReindex: vi.fn(),
    knowledgeDocumentGenerateCaption: vi.fn(),
    knowledgeDocumentCancelCaption: vi.fn(),
    knowledgeDocumentUpdateCaption: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({ client }));

const renderDetail = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeBaseDetail knowledgeBaseId="base-1" />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.knowledgeDocumentGetMany.mockResolvedValue({ data: { documents: [] } });
  api.fileGetMany.mockResolvedValue({ data: { files: [] } });
});

const imageDocument = {
  id: "document-image", original_name: "diagram.png", mime_type: "image/png", revision: 1, position: 0,
  status: "ready", error: null, indexed_at: null, replaces_document_id: null, metadata: {}, created_at: 0, updated_at: 0,
  caption: { status: "draft", source: "local", model: "smolvlm", text: "A draft diagram", error_code: null, error_reason: null, generated_at: 0, accepted_at: null },
};

it("generates, reviews, accepts, and clears an image caption", async () => {
  api.knowledgeDocumentGetMany.mockResolvedValue({ data: { documents: [imageDocument] } });
  api.knowledgeDocumentUpdateCaption.mockResolvedValue({ data: { ...imageDocument, caption: { ...imageDocument.caption, status: "accepted", text: "Reviewed diagram" } } });
  renderDetail();

  const editor = await screen.findByLabelText("Edit caption for diagram.png");
  fireEvent.change(editor, { target: { value: "Reviewed diagram" } });
  fireEvent.click(screen.getByRole("button", { name: "Accept caption" }));
  await waitFor(() => expect(api.knowledgeDocumentUpdateCaption).toHaveBeenCalledWith(expect.objectContaining({
    path: { knowledge_base_id: "base-1", document_id: "document-image" }, body: { text: "Reviewed diagram", accept: true },
  })));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Clear caption" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear caption" }));
  await waitFor(() => expect(api.knowledgeDocumentUpdateCaption).toHaveBeenLastCalledWith(expect.objectContaining({
    path: { knowledge_base_id: "base-1", document_id: "document-image" }, body: { clear: true },
  })));
});

it("removes a document only after confirmation", async () => {
  api.knowledgeDocumentGetMany.mockResolvedValue({ data: { documents: [imageDocument] } });
  api.knowledgeDocumentDelete.mockResolvedValue({});
  renderDetail();

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Remove diagram.png" }));
  expect(api.knowledgeDocumentDelete).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(api.knowledgeDocumentDelete).toHaveBeenCalledWith(expect.objectContaining({
      path: { knowledge_base_id: "base-1", document_id: "document-image" },
    })),
  );
});

it("uploads and attaches every selected file in one operation", async () => {
  api.fileUpload.mockResolvedValue({
    data: { files: [{ id: "file-1" }, { id: "file-2" }] },
  });
  api.knowledgeDocumentCreate
    .mockResolvedValueOnce({ data: { id: "document-1" } })
    .mockResolvedValueOnce({ data: { id: "document-2" } });
  api.knowledgeDocumentIngest.mockResolvedValue({});
  renderDetail();

  fireEvent.change(screen.getByLabelText("Upload knowledge files"), {
    target: { files: [new File(["one"], "one.txt"), new File(["two"], "two.txt")] },
  });

  await waitFor(() => expect(api.fileUpload).toHaveBeenCalledOnce());
  expect(api.fileUpload).toHaveBeenCalledWith(expect.objectContaining({
    body: { files: [expect.any(File), expect.any(File)] },
  }));
  await waitFor(() => expect(api.knowledgeDocumentCreate).toHaveBeenCalledTimes(2));
  expect(api.knowledgeDocumentCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
    path: { knowledge_base_id: "base-1" }, body: { file_id: "file-1" },
  }));
  expect(api.knowledgeDocumentCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({
    path: { knowledge_base_id: "base-1" }, body: { file_id: "file-2" },
  }));
  expect(api.knowledgeDocumentIngest).toHaveBeenCalledTimes(2);
  expect(api.knowledgeDocumentIngest).toHaveBeenCalledWith(expect.objectContaining({
    path: { knowledge_base_id: "base-1", document_id: expect.stringMatching(/^document-/) },
  }));
});
