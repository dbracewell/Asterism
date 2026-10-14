import { ChatInput } from "@/features/chat/components/chat-input";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { fileUpload } = vi.hoisted(() => ({ fileUpload: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  fileUploadMutation: () => ({ mutationFn: fileUpload }),
}));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const render = (component: React.ReactNode) =>
  rtlRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {component}
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
      },
      expect.anything(),
    ),
  );
  expect(onSubmit).toHaveBeenCalledWith({
    requestId: expect.any(String),
    prompt: "Please read this",
    files: ["11111111-1111-4111-8111-111111111111"],
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
