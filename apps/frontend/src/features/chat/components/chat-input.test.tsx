import { ChatInput } from "@/features/chat/components/chat-input";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { fileUpload } = vi.hoisted(() => ({ fileUpload: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  fileUploadMutation: () => ({ mutationFn: fileUpload }),
}));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const render = (component: React.ReactNode) => rtlRender(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
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
    files: [{ id: "11111111-1111-4111-8111-111111111111", filename: "stored-note.txt" }],
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
    expect(fileUpload).toHaveBeenCalledWith({
      body: { files: [expect.any(File)] },
    }, expect.anything()),
  );
  expect(onSubmit).toHaveBeenCalledWith({
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
