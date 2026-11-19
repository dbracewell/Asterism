import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/client";
import { ScopedFileView, passagePlace } from "./scoped-file-view";

const { api } = vi.hoisted(() => ({
  api: { chatFileGetInfo: vi.fn(), chatFileGetPassage: vi.fn() },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const notes = {
  id: "f",
  filename: "notes.txt",
  original_name: "photosynthesis-notes.md",
  size: 10,
  kind: "text",
  projects: [],
};
const passage = {
  chunk_id: "p1",
  kind: "text",
  position: 2,
  total: 12,
  text: "RuBisCO joins carbon dioxide to RuBP.",
};

function setup(cited: string | null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <ScopedFileView chatId="c" fileId="f" passage={cited} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.chatFileGetInfo.mockResolvedValue({ data: notes });
  api.chatFileGetPassage.mockResolvedValue({ data: passage });
});

it("shows the cited passage and where it is in the file (US-90.4)", async () => {
  setup("p1");
  expect(
    await screen.findByText("RuBisCO joins carbon dioxide to RuBP."),
  ).toBeInTheDocument();
  expect(screen.getByText("Passage 2 of 12 in this file.")).toBeInTheDocument();
  expect(api.chatFileGetPassage.mock.calls[0][0].path).toEqual({
    chat_id: "c",
    file_id: "f",
    chunk_id: "p1",
  });
  expect(
    screen.getByRole("heading", { name: "photosynthesis-notes.md" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Download source")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Back to conversation" }),
  ).toHaveAttribute("href", "/c/c");
  expect(screen.queryByText(/Authorized source/)).toBeNull();
});

it("says plainly when the passage is gone, and still offers the file", async () => {
  api.chatFileGetPassage.mockRejectedValue({
    code: 404,
    detail:
      "This passage is no longer in the file. It may have been updated since.",
  });
  setup("p1");
  expect(
    await screen.findByText(/This passage is no longer in the file/),
  ).toBeInTheDocument();
  expect(screen.getByText("Download source")).toBeInTheDocument();
});

it("describes the file in plain words when no passage was cited", async () => {
  setup(null);
  expect(
    await screen.findByText(
      "This file is one of the sources this conversation can use.",
    ),
  ).toBeInTheDocument();
  expect(api.chatFileGetPassage).not.toHaveBeenCalled();
});

it("names an image description as such", () => {
  expect(passagePlace({ ...passage, kind: "caption" })).toBe(
    "From the description of this image, passage 2 of 12.",
  );
});

it("joins a passage's wrapped lines into paragraphs", async () => {
  api.chatFileGetPassage.mockResolvedValue({
    data: {
      ...passage,
      text: "The chloroplast\n\nA chloroplast is surrounded by two membranes and\n\nholds the thylakoids.",
    },
  });
  setup("p1");
  expect(
    await screen.findByText(
      "A chloroplast is surrounded by two membranes and holds the thylakoids.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("The chloroplast").tagName).toBe("P");
});
