import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { messageCopyText } from "@/features/chat/lib/message-copy";
import type { ExerciseView } from "@/lib/client";
import { ExerciseBar } from "./exercise-bar";

const mocks = vi.hoisted(() => ({ attempt: vi.fn(), reveal: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatExerciseAttemptMutation: () => ({ mutationFn: mocks.attempt }),
  chatExerciseRevealMutation: () => ({ mutationFn: mocks.reveal }),
}));

const FILE = "10000000-0000-4000-8000-000000000001";
const open: ExerciseView = {
  valid: true,
  attempts: [],
  found: false,
  revealed: false,
};

function setup(
  exercise: ExerciseView,
  answer = "Water boils at 50 C. Ice floats.",
) {
  const answerRef = createRef<HTMLDivElement>();
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <div ref={answerRef}>
          <p>{answer}</p>
        </div>
        <ExerciseBar
          chatId="chat"
          messageId="msg"
          exercise={exercise}
          answerRef={answerRef}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return screen.getByRole("group", { name: "Spot-the-error exercise" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attempt.mockResolvedValue(open);
  mocks.reveal.mockResolvedValue(open);
});

describe("ExerciseBar", () => {
  it("labels the answer and checks a selection made in the answer", async () => {
    const user = userEvent.setup();
    const bar = setup(open);
    expect(bar).toHaveTextContent(
      "ExerciseThis answer contains one deliberate error. Find it.",
    );
    await user.click(
      within(bar).getByRole("button", { name: "Check selection" }),
    );
    expect(within(bar).getByRole("status")).toHaveTextContent(
      "Select the part of the answer you think is wrong",
    );
    expect(mocks.attempt).not.toHaveBeenCalled();

    // Select "50 C" inside the answer.
    const text = screen.getByText(/Water boils/).firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 15);
    range.setEnd(text, 19);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await user.click(
      within(bar).getByRole("button", { name: "Check selection" }),
    );
    await waitFor(() => expect(mocks.attempt).toHaveBeenCalled());
    expect(mocks.attempt.mock.calls[0][0]).toEqual({
      path: { chat_id: "chat", message_id: "msg" },
      body: { selection: "50 C" },
    });
  });

  it("checks typed words and shows the latest feedback", async () => {
    const user = userEvent.setup();
    const bar = setup({
      ...open,
      attempts: [{ selection: "Ice floats.", result: "not_it", at: 1 }],
    });
    expect(within(bar).getByRole("status")).toHaveTextContent(
      "That is not the deliberate error. Try another part.1 of 20 checks used",
    );
    await user.type(
      within(bar).getByLabelText("Or type the words you think are wrong"),
      "boils at 50 C",
    );
    await user.click(within(bar).getByRole("button", { name: "Check" }));
    await waitFor(() =>
      expect(mocks.attempt.mock.calls[0][0].body).toEqual({
        selection: "boils at 50 C",
      }),
    );
  });

  it("asks before revealing an error the learner has not found", async () => {
    const user = userEvent.setup();
    setup(open);
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Reveal the error?");
    await user.click(within(confirm).getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalled());
  });

  it("reveals without asking once the error was found", async () => {
    const user = userEvent.setup();
    setup({
      ...open,
      found: true,
      attempts: [{ selection: "50 C", result: "found", at: 1 }],
    });
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the revealed error, correction and source as text", () => {
    const bar = setup({
      ...open,
      revealed: true,
      quote: "Water boils at 50 C.",
      correction: "It boils at 100 C <b>at sea level</b>.",
      source: {
        key: "0123456789ab",
        available: true,
        file_id: FILE,
        chunk_id: "c1",
        artifact_generation: 1,
        name: "notes.md",
        excerpt: "Water boils at 100 C.",
      },
    });
    const revealed = bar.querySelector("[data-exercise=revealed]")!;
    expect(revealed).toHaveTextContent("The error: “Water boils at 50 C.”");
    expect(revealed).toHaveTextContent(
      "What is true: It boils at 100 C <b>at sea level</b>.",
    );
    expect(bar.querySelector("b")).toBeNull();
    expect(
      within(bar).getByRole("link", { name: "Evidence: notes.md" }),
    ).toHaveAttribute("href", `/c/chat/files/${FILE}`);
    expect(
      within(bar).queryByRole("button", { name: /Check/ }),
    ).not.toBeInTheDocument();
  });

  it("warns and offers no checks when no error was recorded", () => {
    const bar = setup({ ...open, valid: false });
    expect(bar).toHaveTextContent("has no recorded error");
    expect(within(bar).queryByRole("button")).toBeNull();
  });
});

it("labels copied exercise answers", () => {
  expect(
    messageCopyText({ content: "Water boils at 50 C.", exercise: open }),
  ).toBe(
    "[Exercise: this answer contains one deliberate error.]\n\nWater boils at 50 C.",
  );
  expect(messageCopyText({ content: "Plain." })).toBe("Plain.");
});
