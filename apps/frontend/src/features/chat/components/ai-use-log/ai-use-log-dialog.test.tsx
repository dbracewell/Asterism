import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import type { AiUseLog } from "@/lib/client";
import { AiUseLogDialog } from "./ai-use-log-dialog";

const mocks = vi.hoisted(() => ({ chats: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatSessionGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: [{ _id: "chatSessionGetMany", query }],
    queryFn: () => mocks.chats(query),
  }),
  chatAiUseLogCreateMutation: () => ({ mutationFn: mocks.log }),
}));

const turn = (id: string, prompt: string, exercise = false) => ({
  message_id: id,
  at: 1_700_000_000_000,
  prompt,
  learning_mode: null,
  persona: null,
  template: null,
  rubric: null,
  skills: [],
  files: [],
  compared: false,
  reply: {
    message_id: `r-${id}`,
    at: 1_700_000_000_000,
    status: "completed",
    model: "Alpha",
    tools: [],
    cited_files: [],
    exercise,
    verification: null,
    draft_comments: null,
  },
});

const log: AiUseLog = {
  generated_at: 1_700_000_000_000,
  chats: [
    {
      chat_id: "c1",
      title: "Essay help",
      project: null,
      created_at: 1,
      turns: [turn("u1", "First prompt"), turn("u2", "Second prompt", true)],
    },
  ],
};

let blobs: Blob[] = [];
let cache: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.chats.mockResolvedValue({
    chats: [
      {
        id: "c1",
        title: "Essay help",
        user_id: "a",
        created_at: 1,
        updated_at: 1,
      },
      { id: "c2", title: "Other", user_id: "a", created_at: 1, updated_at: 1 },
    ],
    total: 2,
    page: 1,
    page_size: 100,
  });
  mocks.log.mockResolvedValue(log);
  blobs = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:log";
  });
  URL.revokeObjectURL = vi.fn();
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => vi.restoreAllMocks());

it("chooses chats, then prompts, and downloads the selected Markdown", async () => {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  const user = userEvent.setup();
  render(
    <AiUseLogDialog
      projectId="p1"
      initialChatIds={["c1"]}
      open
      onOpenChange={() => {}}
    />,
    { wrapper: Wrapper },
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Export AI-use log",
  });
  expect(dialog).toHaveTextContent("It does not detect AI use");
  expect(mocks.chats).toHaveBeenCalledWith({
    project_id: "p1",
    page: 1,
    page_size: 100,
  });
  expect(
    await within(dialog).findByRole("checkbox", { name: "Essay help" }),
  ).toBeChecked();
  expect(
    within(dialog).getByRole("checkbox", { name: "Other" }),
  ).not.toBeChecked();
  await user.click(
    within(dialog).getByRole("button", { name: "Choose prompts (1)" }),
  );
  await waitFor(() => expect(mocks.log).toHaveBeenCalled());
  expect(mocks.log.mock.calls[0][0]).toEqual({ body: { chat_ids: ["c1"] } });
  const turns = await screen.findByRole("dialog", { name: "Choose prompts" });
  expect(turns).toHaveTextContent("2 of 2 prompts included.");
  expect(within(turns).getByText(/· Exercise/)).toBeVisible();
  await user.click(
    within(turns).getByRole("checkbox", { name: /First prompt/ }),
  );
  expect(turns).toHaveTextContent("1 of 2 prompts included.");
  await user.click(
    within(turns).getByRole("button", { name: "Download Markdown" }),
  );
  expect(click).toHaveBeenCalled();
  const markdown = await blobs[0].text();
  expect(markdown).toContain("# AI-use log");
  expect(markdown).toContain("Second prompt");
  expect(markdown).not.toContain("First prompt");
  expect(markdown).toContain(
    "Exercise: this answer contained one deliberate error",
  );
  // Building a log is a read; it refreshes nothing.
  expect(invalidate).not.toHaveBeenCalled();
});

it("prints only the log when saving a PDF", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const user = userEvent.setup();
  render(
    <AiUseLogDialog
      projectId={null}
      initialChatIds={["c1"]}
      open
      onOpenChange={() => {}}
    />,
    { wrapper: Wrapper },
  );
  await user.click(
    await screen.findByRole("button", { name: "Choose prompts (1)" }),
  );
  await user.click(await screen.findByRole("button", { name: "Save as PDF" }));
  await waitFor(() => expect(print).toHaveBeenCalled());
  expect(document.body).toHaveClass("print-ai-use-log");
  expect(document.querySelector("[data-print-root]")).toHaveTextContent(
    "Second prompt",
  );
  window.dispatchEvent(new Event("afterprint"));
  await waitFor(() =>
    expect(document.body).not.toHaveClass("print-ai-use-log"),
  );
  expect(document.querySelector("[data-print-root]")).toBeNull();
});
