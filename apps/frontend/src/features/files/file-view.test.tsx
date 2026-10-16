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
    data: {
      status: "ready",
      extracted_content: "hello extracted world",
      caption: { status: "accepted", text: "A short caption" },
    },
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
    data: { status: "pending", caption: { status: null, text: null } },
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
    data: { status: "ready", caption: { text: "Recovered" } },
  });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Recovered")).toBeInTheDocument();
});
