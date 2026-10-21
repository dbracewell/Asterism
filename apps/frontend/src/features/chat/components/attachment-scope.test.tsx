import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiClient, type ToolResult } from "@/lib/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatFileContext } from "./chat-file-context";
import { ChatInput } from "./chat-input";
import { RetrievalCitations } from "./retrieval-citations";
import { ScopedFileView } from "./scoped-file-view";
const F = "11111111-1111-4111-8111-111111111111";
const { api } = vi.hoisted(() => ({
  api: {
    chatFileGetScope: vi.fn(),
    chatFileGetInfo: vi.fn(),
    chatFileRemove: vi.fn(),
    fileKnowledgeGetStatus: vi.fn(),
    fileKnowledgeRegenerate: vi.fn(),
    fileGetMany: vi.fn(),
    projectGetOne: vi.fn(),
    projectFileAddMany: vi.fn(),
    projectFileGetMany: vi.fn(),
    chatDraftCreate: vi.fn(),
    chatDraftGetOne: vi.fn(),
    chatDraftUpload: vi.fn(),
    chatDraftAddFiles: vi.fn(),
    chatDraftRemoveFiles: vi.fn(),
    chatDraftDiscard: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));
const file = (id: string) => ({
  id,
  filename: `${id}.txt`,
  original_name: `${id}.txt`,
  size: 10,
  kind: "text",
  projects: [],
});
function setup(element: React.ReactNode) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        qc.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(element, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={qc}>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryClientProvider>
      ),
    }),
    qc,
  };
}
async function openFromLibrary() {
  await userEvent.click(
    screen.getByRole("button", { name: "Add attachments" }),
  );
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "From library" }),
  );
}
const scope = (chatId = "a") => ({
  chat_id: chatId,
  project_id: "p",
  allowed_file_ids: ["shared", chatId],
  files: [
    { file_id: "shared", sources: ["project"], message_ids: [] },
    { file_id: chatId, sources: ["chat"], message_ids: ["message"] },
  ],
  unavailable_file_ids: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.chatFileGetScope.mockImplementation(({ path }) =>
    Promise.resolve({ data: scope(path.chat_id) }),
  );
  api.chatFileGetInfo.mockImplementation(({ path }) =>
    Promise.resolve({ data: file(path.file_id) }),
  );
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: { status: "pending", extractions: {} },
  });
  api.fileGetMany.mockResolvedValue({
    data: { files: [file("library")], total: 1 },
  });
  api.projectGetOne.mockResolvedValue({
    data: { id: "p", name: "Research", context_revision: 4 },
  });
  api.projectFileAddMany.mockResolvedValue({ data: { context_revision: 5 } });
  api.chatFileRemove.mockResolvedValue({ data: scope() });
  api.chatDraftCreate.mockResolvedValue({
    data: {
      id: "draft",
      chat_id: "a",
      expires_at: 9999999999,
      file_ids: [],
      unavailable_file_ids: [],
    },
  });
  api.chatDraftGetOne.mockImplementation(() =>
    Promise.resolve({
      data: {
        file_ids: [
          ...new Set(
            api.chatDraftAddFiles.mock.calls.flatMap(
              ([call]) => call.body.file_ids,
            ),
          ),
        ],
        unavailable_file_ids: [],
      },
    }),
  );
  api.chatDraftAddFiles.mockResolvedValue({
    data: { id: "draft", file_ids: ["library"] },
  });
  api.chatDraftUpload.mockResolvedValue({ data: { files: [file("upload")] } });
  api.chatDraftRemoveFiles.mockResolvedValue({
    data: { id: "draft", file_ids: [] },
  });
  api.chatDraftDiscard.mockResolvedValue({ data: { id: "draft" } });
});
it("separates shared project files and active chat attachments with scoped links", async () => {
  setup(
    <ChatFileContext open onOpenChange={() => {}} chatId="a" projectId="p" />,
  );
  const shared = within(
    await screen.findByRole("region", { name: "Project files" }),
  );
  const local = within(
    screen.getByRole("region", { name: "Chat attachments" }),
  );
  expect(
    await shared.findByRole("link", { name: "shared.txt" }),
  ).toHaveAttribute("href", "/c/a/files/shared");
  expect(await local.findByRole("link", { name: "a.txt" })).toHaveAttribute(
    "href",
    "/c/a/files/a",
  );
  expect(local.queryByText("shared.txt")).not.toBeInTheDocument();
  expect(api.projectFileAddMany).not.toHaveBeenCalled();
});
it("keeps General empty of project files and does not load library metadata", async () => {
  setup(<ChatFileContext open onOpenChange={() => {}} projectId={null} />);
  expect(screen.getByText(/General has no project files/)).toBeInTheDocument();
  expect(api.fileGetMany).not.toHaveBeenCalled();
  expect(api.projectFileGetMany).not.toHaveBeenCalled();
});
it("removes only local membership after confirmation and adds to a project only when explicitly clicked", async () => {
  setup(
    <ChatFileContext open onOpenChange={() => {}} chatId="a" projectId="p" />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Add to project" }),
  );
  await waitFor(() =>
    expect(api.projectFileAddMany).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { project_id: "p" },
        body: { file_ids: ["a"], expected_context_revision: 4 },
      }),
    ),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Remove chat attachment" }),
  );
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "library file, processing artifacts, and project memberships remain",
  );
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(api.chatFileRemove).toHaveBeenCalledWith(
      expect.objectContaining({ path: { chat_id: "a", file_id: "a" } }),
    ),
  );
});
it("rechecks scope on branch changes and refuses to show stale scope during a failed refresh", async () => {
  const rendered = setup(
    <ChatFileContext
      open
      onOpenChange={() => {}}
      chatId="a"
      projectId="p"
      scopeKey="branch-one"
    />,
  );
  await screen.findByText("a.txt");
  api.chatFileGetScope.mockRejectedValue({ detail: "Scope changed" });
  rendered.rerender(
    <ChatFileContext
      open
      onOpenChange={() => {}}
      chatId="a"
      projectId="p"
      scopeKey="branch-two"
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not verify current file scope",
  );
  expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
  api.chatFileGetScope.mockResolvedValue({
    data: {
      ...scope(),
      files: [{ file_id: "branch-two", sources: ["chat"], message_ids: [] }],
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("branch-two.txt")).toBeInTheDocument();
});
it("stages explicit library picks for one draft and sends that draft without upload or project promotion", async () => {
  const send = vi.fn();
  setup(<ChatInput chatId="a" projectId="p" onSubmit={send} />);
  await openFromLibrary();
  const dialog = within(screen.getByRole("dialog"));
  await userEvent.click(
    await dialog.findByRole("button", { name: /library.txt/ }),
  );
  await userEvent.click(
    dialog.getByRole("button", { name: "Attach selected (1)" }),
  );
  await screen.findByLabelText("Remove library.txt");
  await userEvent.type(screen.getByLabelText("Message"), "Read it");
  await userEvent.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ files: ["library"], draftId: "draft" }),
    ),
  );
  expect(api.chatDraftCreate).toHaveBeenCalledWith(
    expect.objectContaining({ body: { chat_id: "a" } }),
  );
  expect(api.chatDraftUpload).not.toHaveBeenCalled();
  expect(api.projectFileAddMany).not.toHaveBeenCalled();
});
it("removes staged references without deleting source files and clears expired drafts explicitly", async () => {
  setup(<ChatInput onSubmit={vi.fn()} />);
  await userEvent.upload(
    screen.getByLabelText("Choose attachments"),
    new File(["x"], "note.txt"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Upload / retry attachments" }),
  );
  expect(await screen.findByText("Ready")).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Remove note.txt"));
  await waitFor(() =>
    expect(api.chatDraftRemoveFiles).toHaveBeenCalledWith(
      expect.objectContaining({ body: { file_ids: ["upload"] } }),
    ),
  );
  await userEvent.upload(
    screen.getByLabelText("Choose attachments"),
    new File(["x"], "later.txt"),
  );
  api.chatDraftDiscard.mockRejectedValue({ detail: "Draft expired" });
  await userEvent.click(
    screen.getByRole("button", { name: "Discard attachments" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Attachments cleared here",
  );
  expect(screen.queryByLabelText("Remove later.txt")).not.toBeInTheDocument();
});
it("shows retrieval provenance but denies links when the source is no longer authorized", async () => {
  const results = [
    {
      tool_call: { function: { name: "search_knowledge" } },
      raw_result: {
        results: [
          {
            file_id: F,
            sources: ["chat"],
            artifact_generation: 2,
            chunk_id: "chunk",
            score: 0.9,
            match_kind: "text",
          },
        ],
      },
    },
  ] as ToolResult[];
  const rendered = setup(<RetrievalCitations chatId="a" results={results} />);
  expect(await screen.findByRole("link", { name: `${F}.txt` })).toHaveAttribute(
    "href",
    `/c/a/files/${F}`,
  );
  expect(screen.getByText("At retrieval: This chat")).toBeInTheDocument();
  api.chatFileGetInfo.mockRejectedValue({ detail: "No longer in scope" });
  await rendered.qc.invalidateQueries();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Retrieved source unavailable",
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("a scoped file view fails closed on revoked access rather than opening the library", async () => {
  api.chatFileGetInfo.mockRejectedValue({ detail: "Forbidden" });
  setup(<ScopedFileView chatId="a" fileId="source" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no longer available in the active chat context",
  );
  expect(screen.queryByText("Download source")).not.toBeInTheDocument();
});

it("blocks an unconfirmed server-side draft selection and allows explicit discard", async () => {
  const send = vi.fn();
  api.chatDraftGetOne.mockResolvedValue({
    data: { file_ids: ["library", "unconfirmed"], unavailable_file_ids: [] },
  });
  setup(<ChatInput chatId="a" onSubmit={send} />);
  await openFromLibrary();
  const picker = within(screen.getByRole("dialog"));
  await userEvent.click(
    await picker.findByRole("button", { name: /library.txt/ }),
  );
  await userEvent.click(
    picker.getByRole("button", { name: "Attach selected (1)" }),
  );
  await screen.findByLabelText("Remove library.txt");
  await userEvent.type(
    screen.getByLabelText("Message"),
    "Use only what I picked",
  );
  await userEvent.click(screen.getByLabelText("Send message"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "unconfirmed selection",
  );
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Discard attachments" }),
  );
  await userEvent.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ files: [] })),
  );
  expect(send.mock.calls[0][0]).not.toHaveProperty("draftId");
});
