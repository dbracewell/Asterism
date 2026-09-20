import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ChatInput from "./chat-input";

const { fileUpload } = vi.hoisted(() => ({ fileUpload: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { fileUpload } }));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  fileUpload.mockReset();
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
});
afterEach(() => vi.restoreAllMocks());

it("uploads picker files through the generated client then includes filenames in the submit payload", async () => {
  const onSubmit = vi.fn();
  fileUpload.mockResolvedValue({ data: { files: [{ filename: "stored-note.txt" }] } });
  render(<ChatInput onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Please read this");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] },
  });
  await user.click(screen.getByLabelText("Send message"));
  await waitFor(() => expect(fileUpload).toHaveBeenCalledWith({ body: { files: [expect.any(File)] } }));
  expect(onSubmit).toHaveBeenCalledWith({ prompt: "Please read this", files: ["stored-note.txt"] });
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
  expect(await screen.findByRole("alert")).toHaveTextContent("note.txt: File is too large");
  expect(screen.getByLabelText("Message")).toHaveValue("Keep this prompt");
});
