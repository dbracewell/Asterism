import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiClient } from "@/lib/client";
import { KnowledgeBaseDetail } from "./knowledge-base-detail";

const { api, client, back } = vi.hoisted(() => ({
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
  vi.clearAllMocks();
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
  expect(await screen.findByText("Knowledge Base: Research")).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "Add files" }));
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
