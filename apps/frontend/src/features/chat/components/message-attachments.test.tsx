import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageFileReference } from "@/lib/client";
import { MessageAttachments } from "./message-attachments";

vi.mock("@/components/api-download", () => ({
  APIDownload: ({ fileId, chatId }: { fileId: string; chatId: string }) => (
    <a href={`/chat/${chatId}/files/${fileId}`}>Source</a>
  ),
}));
vi.mock("@/components/api-image", () => ({ APIImage: () => null }));

const reference: MessageFileReference = {
  file_id: "10000000-0000-4000-8000-000000000001",
  filename: "name.txt",
  name: "name.txt",
  mime_type: "text/plain",
  size: 3,
  kind: "text",
  status: "ready",
};

it("links the immutable source ID within the chat scope", () => {
  render(<MessageAttachments chatId="chat-1" files={[reference]} />);
  expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
    "href",
    `/chat/chat-1/files/${reference.file_id}`,
  );
});

it("shows unavailable history without linking a replacement filename", () => {
  render(
    <MessageAttachments
      chatId="chat-1"
      files={[{ ...reference, status: "failed" }]}
    />,
  );
  expect(screen.getByText(/name.txt.*unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("shows revoked source snapshots without a download link", () => {
  render(
    <MessageAttachments
      chatId="chat-1"
      files={[{ ...reference, available: false }]}
    />,
  );
  expect(screen.getByText(/name.txt.*unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
