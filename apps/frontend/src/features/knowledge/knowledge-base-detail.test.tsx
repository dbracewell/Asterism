import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiClient } from "@/lib/client";
import { KnowledgeBaseDetail } from "./knowledge-base-detail";

const { api, client, back, toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
  back: vi.fn(),
  client: { getConfig: () => ({ baseUrl: "" }) },
  api: {
    knowledgeBaseGetOne: vi.fn(),
    fileGetMany: vi.fn(),
    fileGetFileInfo: vi.fn(),
    fileKnowledgeGetStatus: vi.fn(),
    fileUpload: vi.fn(),
    knowledgeBaseFileCreateMany: vi.fn(),
    knowledgeBaseFileDeleteMany: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({ client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function renderDetail(
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <KnowledgeBaseDetail knowledgeBaseId="base-1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const file = (id: string, name: string, inChecked = false) => ({
  id,
  filename: name,
  original_name: name,
  size: 5,
  kind: "text",
  mime_type: "text/plain",
  content_status: "ready",
  knowledge_base_count: inChecked ? 1 : 0,
  in_checked_knowledge_base: inChecked,
});

type ListOptions = {
  query?: { knowledge_base_id?: string; check_knowledge_base_id?: string };
};

beforeEach(() => {
  vi.resetAllMocks();
  ApiClient.__registry.set(api as never);
  api.knowledgeBaseGetOne.mockResolvedValue({
    data: { id: "base-1", name: "Research", description: "Private notes" },
  });
  api.fileGetMany.mockImplementation(async ({ query }: ListOptions) => {
    const files = query?.knowledge_base_id
      ? [file("member", "member.txt", true)]
      : [file("member", "member.txt", true), file("fresh", "fresh.txt")];
    return { data: { files, total: files.length } };
  });
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: { status: "ready", caption: { status: null, text: null } },
  });
});

it("lists member files in the explorer and removes only the membership", async () => {
  api.knowledgeBaseFileDeleteMany.mockResolvedValue({ data: { files: [] } });
  renderDetail();
  const user = userEvent.setup();
  expect(
    await screen.findByText("Knowledge Base: Research"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(back).toHaveBeenCalledOnce();
  expect(api.fileGetMany).toHaveBeenCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ knowledge_base_id: "base-1" }),
    }),
  );
  await user.click(await screen.findByRole("button", { name: /member\.txt/ }));
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
        body: { file_ids: ["member"] },
      }),
    ),
  );
});

it("adds selected files from the picker, which has no delete and blocks existing members", async () => {
  api.knowledgeBaseFileCreateMany.mockResolvedValue({ data: { files: [] } });
  renderDetail();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add files" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    await within(dialog).findByText(/Already in this knowledge base/),
  ).toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: /Delete selected files/ }),
  ).not.toBeInTheDocument();

  const add = within(dialog).getByRole("button", { name: /Add selected/ });
  await user.click(within(dialog).getByRole("button", { name: /member\.txt/ }));
  expect(add).toBeDisabled();

  await user.click(within(dialog).getByRole("button", { name: /fresh\.txt/ }));
  await user.click(
    within(dialog).getByRole("button", { name: "Add selected (1)" }),
  );
  await waitFor(() =>
    expect(api.knowledgeBaseFileCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { knowledge_base_id: "base-1" },
        body: { file_ids: ["fresh"] },
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("shows loading before enabling knowledge-base management", async () => {
  api.knowledgeBaseGetOne.mockReturnValue(new Promise(() => {}));
  renderDetail();
  expect(screen.getByText("Loading...")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add files" }),
  ).not.toBeInTheDocument();
  expect(api.fileGetMany).not.toHaveBeenCalled();
});

it("handles a missing knowledge base and retries without mounting its explorer", async () => {
  api.knowledgeBaseGetOne.mockRejectedValueOnce({
    code: "not_found",
    detail: "Knowledge base not found.",
  });
  renderDetail();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Knowledge base not found.",
  );
  expect(
    screen.queryByRole("button", { name: "Add files" }),
  ).not.toBeInTheDocument();
  expect(api.fileGetMany).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("Knowledge Base: Research"),
  ).toBeInTheDocument();
  expect(await screen.findByText("member.txt")).toBeInTheDocument();
});

it("shows a generic knowledge-base error for network failures", async () => {
  api.knowledgeBaseGetOne.mockRejectedValue(new TypeError("Failed to fetch"));
  renderDetail();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load knowledge base.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(back).toHaveBeenCalledOnce();
});

it("distinguishes a failed file query from an empty list and retries", async () => {
  api.fileGetMany.mockRejectedValueOnce({
    code: "unavailable",
    detail: "File service unavailable.",
  });
  renderDetail();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "File service unavailable.",
  );
  expect(screen.queryByText("No files found.")).not.toBeInTheDocument();
  expect(screen.queryByText(/Page 0 of 0/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("member.txt")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("retains cached files and displays errors when a refresh fails", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderDetail(queryClient);
  expect(await screen.findByText("member.txt")).toBeInTheDocument();
  api.fileGetMany.mockRejectedValue(new TypeError("Failed to fetch"));
  await act(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        (query.queryKey[0] as { _id?: string } | undefined)?._id ===
        "fileGetMany",
    });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load files.",
  );
  expect(screen.getByText("member.txt")).toBeInTheDocument();
});

it("shows file-query errors inside the add-files picker", async () => {
  renderDetail();
  expect(await screen.findByText("member.txt")).toBeInTheDocument();
  api.fileGetMany.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await userEvent.click(screen.getByRole("button", { name: "Add files" }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Unable to load files.",
  );
  expect(
    within(dialog).getByRole("button", { name: "Add selected (0)" }),
  ).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  expect(await within(dialog).findByText("fresh.txt")).toBeInTheDocument();
});

it("reports file processing status failures and retries", async () => {
  api.fileKnowledgeGetStatus.mockRejectedValueOnce(
    new TypeError("Failed to fetch"),
  );
  renderDetail();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load file processing status.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Embedding: ready")).toBeInTheDocument();
});

it("reports regeneration failures", async () => {
  const regenerate = vi
    .fn()
    .mockRejectedValue(new TypeError("Failed to fetch"));
  ApiClient.__registry.set({
    ...api,
    fileKnowledgeRegenerate: regenerate,
  } as never);
  renderDetail();
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Regenerate embedding and caption",
    }),
  );
  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith(
      "Unable to regenerate embedding and caption.",
    ),
  );
});

it("prevents repeated retry while loading and recovers to an empty list", async () => {
  let resolveFiles!: (value: {
    data: { files: never[]; total: number };
  }) => void;
  api.fileGetMany
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFiles = resolve;
        }),
    );
  renderDetail();
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Loading...")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  await act(async () => resolveFiles({ data: { files: [], total: 0 } }));
  expect(await screen.findByText("No files found.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Page 0 of 0")).toBeInTheDocument();
});

it("handles structured validation errors without rendering their detail as an object", async () => {
  api.fileGetMany.mockRejectedValue({ detail: [{ msg: "Invalid request" }] });
  renderDetail();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load files.",
  );
});
