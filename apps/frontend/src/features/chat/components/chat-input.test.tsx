import { ChatInput } from "@/features/chat/components/chat-input";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { fileUpload } = vi.hoisted(() => ({ fileUpload: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatDraftCreateMutation: () => ({
    mutationFn: async () => ({ id: "draft-1" }),
  }),
  chatDraftUploadMutation: () => ({ mutationFn: fileUpload }),
  chatDraftGetOneOptions: () => ({
    queryKey: ["draft"],
    queryFn: async () => ({
      file_ids: [
        ...new Set(
          (
            await Promise.allSettled(
              fileUpload.mock.results.map((result) => result.value),
            )
          ).flatMap((result) =>
            result.status === "fulfilled"
              ? result.value.files.map((file: { id: string }) => file.id)
              : [],
          ),
        ),
      ],
      unavailable_file_ids: [],
    }),
  }),
  chatDraftAddFilesMutation: () => ({ mutationFn: vi.fn() }),
  chatDraftRemoveFilesMutation: () => ({ mutationFn: vi.fn() }),
  chatDraftDiscardMutation: () => ({ mutationFn: async () => ({}) }),
  fileKnowledgeGetStatusOptions: () => ({
    queryKey: ["processing"],
    queryFn: async () => ({ status: "ready", extractions: {} }),
  }),
  fileKnowledgeRegenerateMutation: () => ({ mutationFn: vi.fn() }),
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: async () => [
      { id: "a", name: "Alpha", available: true },
      { id: "b", name: "Beta", available: true },
    ],
  }),
  projectFileGetManyOptions: () => ({
    queryKey: ["project-files"],
    queryFn: async () => ({ files: [], total: 0 }),
  }),
}));
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposerNotice } from "./composer-notice";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const render = (component: React.ReactNode) =>
  rtlRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <TooltipProvider>{component}</TooltipProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  fileUpload.mockReset();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => vi.restoreAllMocks());

it("uploads picker files through the generated client then includes stable file IDs in the submit payload", async () => {
  const onSubmit = vi.fn();
  fileUpload.mockResolvedValue({
    files: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        filename: "stored-note.txt",
      },
    ],
  });
  render(<ChatInput onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Please read this");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: [new File(["hello"], "note.txt", { type: "text/plain" })],
    },
  });
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() =>
    expect(fileUpload).toHaveBeenCalledWith(
      {
        body: { files: [expect.any(File)] },
        path: { draft_id: "draft-1" },
      },
      expect.anything(),
    ),
  );
  expect(onSubmit).toHaveBeenCalledWith({
    requestId: expect.any(String),
    prompt: "Please read this",
    files: ["11111111-1111-4111-8111-111111111111"],
    draftId: "draft-1",
  });
});

it("shows an explicit stop control while generation is active", async () => {
  const onStop = vi.fn();
  render(
    <ChatInput disabled isProcessing onStop={onStop} onSubmit={() => {}} />,
  );

  await userEvent.setup().click(screen.getByLabelText("Stop generating"));

  expect(onStop).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Send message")).not.toBeInTheDocument();
});

it("keeps the prompt and shows a retryable error when any upload fails", async () => {
  fileUpload.mockRejectedValue(new Error("File is too large"));
  render(<ChatInput onSubmit={vi.fn()} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Keep this prompt");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: { files: [new File(["hello"], "note.txt")] },
  });
  await user.click(screen.getByLabelText("Send message"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "note.txt: File is too large",
  );
  expect(screen.getByLabelText("Message")).toHaveValue("Keep this prompt");
});

it("retains successful uploads and the same request ID after a failed send", async () => {
  fileUpload.mockResolvedValue({ files: [{ id: "source-id" }] });
  const onSubmit = vi
    .fn()
    .mockRejectedValueOnce(new Error("Send unavailable"))
    .mockResolvedValueOnce(undefined);
  render(<ChatInput onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Keep for retry");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: { files: [new File(["data"], "retry.txt")] },
  });
  await user.click(screen.getByLabelText("Send message"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Send unavailable",
  );
  expect(screen.getByLabelText("Message")).toHaveValue("Keep for retry");
  expect(screen.getByText("Ready")).toBeInTheDocument();
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  expect(fileUpload).toHaveBeenCalledOnce();
  expect(onSubmit).toHaveBeenCalledTimes(2);
  expect(onSubmit.mock.calls[1][0]).toEqual(onSubmit.mock.calls[0][0]);
});

it("retries only failed uploads and prevents duplicate submissions while acceptance is pending", async () => {
  fileUpload
    .mockResolvedValueOnce({ files: [{ id: "good-id" }] })
    .mockRejectedValueOnce(new Error("Upload failed"))
    .mockResolvedValueOnce({ files: [{ id: "retry-id" }] });
  let accept: () => void = () => {};
  const onSubmit = vi.fn<
    (data: {
      prompt: string;
      files: string[];
      requestId: string;
    }) => Promise<void>
  >(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  render(<ChatInput onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Both files");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: [new File(["a"], "good.txt"), new File(["b"], "retry.txt")],
    },
  });
  await user.click(screen.getByLabelText("Send message"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  expect(fileUpload).toHaveBeenCalledTimes(3);
  expect(onSubmit.mock.calls[0][0].files).toEqual(["good-id", "retry-id"]);
  expect(screen.getByLabelText("Send message")).toBeDisabled();
  expect(screen.getByLabelText("Remove good.txt")).toBeDisabled();
  expect(screen.getByLabelText("Message")).toHaveValue("Both files");
  accept();
  await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
});

it("cleans queued preview resources on removal and abandonment without uploading", async () => {
  const rendered = render(<ChatInput onSubmit={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: [new File(["image"], "draft.png", { type: "image/png" })],
    },
  });
  await userEvent.setup().click(screen.getByLabelText("Remove draft.png"));
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: [new File(["image"], "abandoned.png", { type: "image/png" })],
    },
  });
  rendered.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(fileUpload).not.toHaveBeenCalled();
});

it("offers upload, library, paste, screenshot and files in context from the add menu", async () => {
  const user = userEvent.setup();
  render(<ChatInput onSubmit={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "More options" }));
  for (const name of [
    "Upload files",
    "From library",
    "Paste from clipboard",
    "Take screenshot",
    "Files in context",
  ])
    expect(await screen.findByRole("menuitem", { name })).toBeVisible();
  await user.click(screen.getByRole("menuitem", { name: "Files in context" }));
  expect(
    await screen.findByRole("dialog", { name: "Files in context" }),
  ).toBeVisible();
  expect(screen.queryByText(/Next message/)).not.toBeInTheDocument();
});

it("opens the file chooser from the upload menu item", async () => {
  const user = userEvent.setup();
  render(<ChatInput onSubmit={vi.fn()} />);
  const click = vi.spyOn(HTMLInputElement.prototype, "click");
  await user.click(screen.getByRole("button", { name: "More options" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Upload files" }),
  );
  expect(click).toHaveBeenCalledOnce();
});

it("attaches pasted images with distinct names and leaves pasted text alone", () => {
  render(<ChatInput onSubmit={vi.fn()} />);
  const image = new File(["x"], "image.png", { type: "image/png" });
  fireEvent.paste(screen.getByLabelText("Message"), {
    clipboardData: { files: [image], getData: () => "" },
  });
  expect(screen.getByLabelText(/^Remove pasted-image-.*\.png$/)).toBeVisible();
  fireEvent.paste(screen.getByLabelText("Message"), {
    clipboardData: { files: [image], getData: () => "copied text" },
  });
  expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(1);
});

it("puts chips in the top row and their notices below it", () => {
  render(
    <ChatInput
      onSubmit={vi.fn()}
      chips={
        <>
          <button type="button">Chat model</button>
          <ComposerNotice role="alert">Could not load models.</ComposerNotice>
        </>
      }
    />,
  );
  const row = screen.getByRole("group", { name: "Message options" });
  expect(row).toContainElement(
    screen.getByRole("button", { name: "Chat model" }),
  );
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("Could not load models.");
  expect(row).not.toContainElement(alert);
});

it("opens comparison from the menu and shows a chip while models are chosen", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <ChatInput onSubmit={vi.fn()} compare={{ value: [], onChange }} />,
  );
  expect(
    screen.queryByRole("button", { name: /^Compare models/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "More options" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Compare models" }),
  );
  const popover = await screen.findByRole("dialog", { name: "Compare models" });
  await user.click(
    await within(popover).findByRole("checkbox", { name: "Alpha" }),
  );
  expect(onChange).toHaveBeenCalledWith(["a"]);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "More options" })).toHaveFocus();
  rerender(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ChatInput
          onSubmit={vi.fn()}
          compare={{ value: ["a", "b"], onChange }}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Compare models (2 selected)" }),
  ).toBeVisible();
});

it("opens chat controls help from the menu and returns focus to it", async () => {
  const user = userEvent.setup();
  render(<ChatInput onSubmit={vi.fn()} />);
  expect(
    screen.queryByRole("button", { name: "Help: Chat controls" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "More options" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Help: chat controls" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Help: Chat controls" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "More options" })).toHaveFocus();
});
