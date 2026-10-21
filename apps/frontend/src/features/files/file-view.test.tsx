import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ApiClient } from "@/lib/client";
import { FileView } from "./file-view";

const { api, client } = vi.hoisted(() => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
  api: {
    fileGetFileInfo: vi.fn(),
    fileKnowledgeGetStatus: vi.fn(),
    fileSimilarGetMany: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({ client }));

const back = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));

const file = (id: string, name: string) => ({
  id,
  filename: name,
  original_name: name,
  size: 10,
  mime_type: "text/plain",
  kind: "text",
  projects: [{ id: "p-1", name: "References" }],
});

const artifact = (
  extractions: Record<string, unknown>,
  status = "ready",
) => ({ status, extractions });

function renderView() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FileView filename="notes.txt" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.fileGetFileInfo.mockResolvedValue({ data: file("1", "notes.txt") });
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: artifact({
      text_extraction: {
        kind: "text_extraction",
        status: "ready",
        payload: { content: "hello extracted world" },
      },
      embedding: {
        kind: "embedding",
        status: "ready",
        payload: { text_ready: true, visual_ready: false },
      },
      captioning: {
        kind: "captioning",
        status: "ready",
        payload: { text: "A short caption" },
      },
    }),
  });
  api.fileSimilarGetMany.mockResolvedValue({
    data: { files: [{ file: file("2", "other.txt"), score: 0.8123 }] },
  });
});

it("shows content, caption, similar files with scores, and projects", async () => {
  renderView();

  expect(await screen.findByText("hello extracted world")).toBeInTheDocument();
  expect(screen.getByText("A short caption")).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "other.txt" }),
  ).toHaveAttribute("href", "/files/other.txt");
  expect(screen.getByText("0.812")).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "References" }),
  ).toHaveAttribute("href", "/projects/p-1");
});

it("goes back through the Next.js router", async () => {
  renderView();

  await userEvent.click(await screen.findByRole("button", { name: "Back" }));

  expect(back).toHaveBeenCalledOnce();
});

it("shows empty states when nothing is available", async () => {
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: artifact({}, "pending"),
  });
  api.fileSimilarGetMany.mockResolvedValue({ data: { files: [] } });
  api.fileGetFileInfo.mockResolvedValue({
    data: { ...file("1", "notes.txt"), projects: [] },
  });
  renderView();

  expect(await screen.findByText("No caption.")).toBeInTheDocument();
  expect(
    screen.getByText("Content is not available until processing is ready."),
  ).toBeInTheDocument();
  expect(await screen.findByText("No similar files.")).toBeInTheDocument();
  expect(
    await screen.findByText("This file is not in any project."),
  ).toBeInTheDocument();
});

it("keeps project memberships visible when processing artifacts cannot load", async () => {
  api.fileKnowledgeGetStatus.mockRejectedValue({
    detail: "Processing record missing",
  });
  renderView();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load file processing artifacts",
  );
  expect(screen.getByRole("link", { name: "References" })).toHaveAttribute(
    "href",
    "/projects/p-1",
  );
  expect(screen.queryByText("No caption.")).not.toBeInTheDocument();
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: artifact({
      captioning: {
        kind: "captioning",
        status: "ready",
        payload: { text: "Recovered" },
      },
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Recovered")).toBeInTheDocument();
});

it("keeps adversarial extracted HTML and captions as literal text", async () => {
  const payload =
    '<img src="/untrusted-markdown/file" onerror="alert(1)"><form action="/steal">secret</form>';
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: artifact({
      text_extraction: {
        kind: "text_extraction",
        status: "ready",
        payload: { content: payload },
      },
      captioning: {
        kind: "captioning",
        status: "ready",
        payload: { text: payload },
      },
    }),
  });
  const { container } = renderView();
  expect(await screen.findAllByText(payload)).toHaveLength(2);
  expect(container.querySelector("img,form,[onerror]")).toBeNull();
});
