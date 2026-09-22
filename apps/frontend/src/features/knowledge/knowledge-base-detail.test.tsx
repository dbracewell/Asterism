import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { KnowledgeBaseDetail } from "./knowledge-base-detail";

const { api } = vi.hoisted(() => ({
  api: {
    knowledgeDocumentGetMany: vi.fn(),
    fileGetMany: vi.fn(),
    fileUpload: vi.fn(),
    knowledgeDocumentCreate: vi.fn(),
    knowledgeDocumentIngest: vi.fn(),
    knowledgeDocumentDelete: vi.fn(),
    knowledgeDocumentReindex: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({ api }));

beforeEach(() => {
  vi.clearAllMocks();
  api.knowledgeDocumentGetMany.mockResolvedValue({ data: { documents: [] } });
  api.fileGetMany.mockResolvedValue({ data: { files: [] } });
});

it("uploads and attaches every selected file in one operation", async () => {
  api.fileUpload.mockResolvedValue({
    data: { files: [{ id: "file-1" }, { id: "file-2" }] },
  });
  api.knowledgeDocumentCreate
    .mockResolvedValueOnce({ data: { id: "document-1" } })
    .mockResolvedValueOnce({ data: { id: "document-2" } });
  api.knowledgeDocumentIngest.mockResolvedValue({});
  render(<KnowledgeBaseDetail knowledgeBaseId="base-1" />);

  fireEvent.change(screen.getByLabelText("Upload knowledge files"), {
    target: { files: [new File(["one"], "one.txt"), new File(["two"], "two.txt")] },
  });

  await waitFor(() => expect(api.fileUpload).toHaveBeenCalledOnce());
  expect(api.fileUpload).toHaveBeenCalledWith({
    body: { files: [expect.any(File), expect.any(File)] },
  });
  await waitFor(() => expect(api.knowledgeDocumentCreate).toHaveBeenCalledTimes(2));
  expect(api.knowledgeDocumentCreate).toHaveBeenNthCalledWith(1, {
    path: { knowledge_base_id: "base-1" }, body: { file_id: "file-1" },
  });
  expect(api.knowledgeDocumentCreate).toHaveBeenNthCalledWith(2, {
    path: { knowledge_base_id: "base-1" }, body: { file_id: "file-2" },
  });
  expect(api.knowledgeDocumentIngest).toHaveBeenCalledTimes(2);
  expect(api.knowledgeDocumentIngest).toHaveBeenCalledWith({
    path: { knowledge_base_id: "base-1", document_id: expect.stringMatching(/^document-/) },
  });
});
