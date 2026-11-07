import {
  ApiClient,
  type ChatInfo,
  type HintLevel,
  type LearningModeCatalog,
} from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatHintControls } from "./chat-hint-controls";

const { api, raised } = vi.hoisted(() => ({
  api: { learningModeGetMany: vi.fn(), courseModePolicyGet: vi.fn() },
  raised: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const catalog: LearningModeCatalog = {
  modes: [
    { id: "standard", name: "Standard", description: "", version: 1 },
    {
      id: "tutor",
      name: "Tutor",
      description: "",
      version: 2,
      hint_levels: ["nudge", "hint", "worked_example", "answer"],
    },
    {
      id: "review",
      name: "Review my work",
      description: "",
      version: 2,
      hint_levels: ["answer"],
    },
  ],
};

beforeEach(() => {
  api.learningModeGetMany.mockReset();
  raised.mockReset();
  ApiClient.__registry.set(api as never);
  api.learningModeGetMany.mockResolvedValue({ data: catalog });
});

afterEach(() => {
  vi.useRealTimers();
});

function info(
  learning_mode: ChatInfo["learning_mode"],
  hint_level: HintLevel,
  learning_mode_locked = false,
) {
  return {
    id: "chat",
    learning_mode,
    hint_level,
    learning_mode_locked,
  } as ChatInfo;
}

function Harness({
  mode = "tutor",
  level = "none",
  disabled = false,
  locked = false,
}: {
  mode?: ChatInfo["learning_mode"];
  level?: HintLevel;
  disabled?: boolean;
  locked?: boolean;
}) {
  const [reset, setReset] = useState(false);
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ChatHintControls
        info={info(mode, level, locked)}
        disabled={disabled}
        resetPending={reset}
        onResetChange={setReset}
        onRaise={raised}
      />
    </QueryClientProvider>
  );
}

it("renders nothing for modes without hints", async () => {
  const { container } = render(<Harness mode="standard" />);
  await vi.waitFor(() => expect(api.learningModeGetMany).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it("shows the current level and only offers stronger help", async () => {
  const user = userEvent.setup();
  render(<Harness level="hint" />);
  const group = await screen.findByRole("group", { name: "Hint controls" });
  expect(group).toHaveTextContent("Help level: Hint");
  expect(screen.getByRole("button", { name: "Nudge" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Hint" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Worked example" }));
  expect(raised).toHaveBeenCalledWith(
    { level: "worked_example" },
    "Show me a worked example.",
  );
});

it("needs a confirmation before showing the answer", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(await screen.findByRole("button", { name: "Show answer" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Show the full answer?");
  await user.click(screen.getByRole("button", { name: "Keep trying" }));
  expect(raised).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(
    Array.from(confirm.querySelectorAll("button")).find(
      (button) => button.textContent === "Show answer",
    )!,
  );
  expect(raised).toHaveBeenCalledWith(
    { level: "answer", confirm_reveal: true },
    "Show me the answer.",
  );
});

it("starts a new problem from the next message and resets before raising", async () => {
  const user = userEvent.setup();
  render(<Harness level="answer" />);
  expect(
    await screen.findByRole("button", { name: "Show answer" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "New problem" }));
  expect(screen.getByRole("group")).toHaveTextContent(
    "Help level: Questions only (from your next message)",
  );
  await user.click(screen.getByRole("button", { name: "Nudge" }));
  expect(raised).toHaveBeenCalledWith(
    { level: "nudge", reset: true },
    "Give me a nudge.",
  );
  await user.click(screen.getByRole("button", { name: "Keep current level" }));
  expect(screen.getByRole("group")).toHaveTextContent(
    "Help level: Answer shown",
  );
});

it("disables every control while busy but keeps help available", async () => {
  render(<Harness level="nudge" disabled />);
  await screen.findByRole("group", { name: "Hint controls" });
  const help = screen.getByRole("button", { name: "Help: Hint levels" });
  expect(help).toBeEnabled();
  for (const button of screen.getAllByRole("button")) {
    if (button !== help) expect(button).toBeDisabled();
  }
});

it("explains the reveal step in Review my work", async () => {
  render(<Harness mode="review" />);
  await screen.findByRole("group", { name: "Hint controls" });
  expect(
    screen.getByRole("button", { name: "Help: Show answer" }),
  ).toBeInTheDocument();
});

it("offers Review only the confirmed corrected solution", async () => {
  const user = userEvent.setup();
  render(<Harness mode="review" />);
  const group = await screen.findByRole("group", { name: "Hint controls" });
  expect(group).toHaveTextContent("Help level: Feedback only");
  expect(
    screen.queryByRole("button", { name: "Nudge" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Show answer" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show solution" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Show a corrected solution?");
  await user.click(screen.getByRole("button", { name: "Keep trying" }));
  expect(raised).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Show solution" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(
    Array.from(confirm.querySelectorAll("button")).find(
      (button) => button.textContent === "Show solution",
    )!,
  );
  expect(raised).toHaveBeenCalledWith(
    { level: "answer", confirm_reveal: true },
    "Show me a corrected solution.",
  );
});

it("starts a new Review attempt after the solution is shown", async () => {
  const user = userEvent.setup();
  render(<Harness mode="review" level="answer" />);
  expect(
    await screen.findByRole("button", { name: "Show solution" }),
  ).toBeDisabled();
  expect(screen.getByRole("group")).toHaveTextContent(
    "Help level: Solution shown",
  );
  await user.click(screen.getByRole("button", { name: "New attempt" }));
  expect(screen.getByRole("group")).toHaveTextContent(
    "Help level: Feedback only (from your next message)",
  );
  await user.click(screen.getByRole("button", { name: "Show solution" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(
    Array.from(confirm.querySelectorAll("button")).find(
      (button) => button.textContent === "Show solution",
    )!,
  );
  expect(raised).toHaveBeenCalledWith(
    { level: "answer", confirm_reveal: true, reset: true },
    "Show me a corrected solution.",
  );
});

it("makes a locked chat wait before the reveal and sends the lock override", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<Harness locked level="hint" />);
  await user.click(await screen.findByRole("button", { name: "Show answer" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("You locked this chat's mode");
  const confirm = Array.from(dialog.querySelectorAll("button")).find((button) =>
    button.textContent?.startsWith("Show answer"),
  )!;
  expect(confirm).toBeDisabled();
  expect(confirm).toHaveTextContent("Show answer(5)");
  act(() => vi.advanceTimersByTime(4000));
  expect(confirm).toBeDisabled();
  expect(confirm).toHaveTextContent("(1)");
  act(() => vi.advanceTimersByTime(1000));
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  expect(raised).toHaveBeenCalledWith(
    { level: "answer", confirm_reveal: true, override_lock: true },
    "Show me the answer.",
  );
});

it("restarts the wait each time the locked reveal opens", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<Harness locked />);
  await user.click(await screen.findByRole("button", { name: "Show answer" }));
  act(() => vi.advanceTimersByTime(3000));
  await user.click(screen.getByRole("button", { name: "Keep trying" }));
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  const dialog = await screen.findByRole("alertdialog");
  const confirm = Array.from(dialog.querySelectorAll("button")).find((button) =>
    button.textContent?.startsWith("Show answer"),
  )!;
  expect(confirm).toBeDisabled();
  expect(confirm).toHaveTextContent("(5)");
  expect(raised).not.toHaveBeenCalled();
});

it("hides the reveal when the class policy turns it off", async () => {
  api.courseModePolicyGet.mockResolvedValue({
    data: {
      class_name: "Biology 101",
      educator_name: "Dr Teach",
      allowed_modes: null,
      answer_reveal: false,
    },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatHintControls
        info={{ ...info("tutor", "none"), project_id: "course" } as ChatInfo}
        disabled={false}
        resetPending={false}
        onResetChange={() => {}}
        onRaise={raised}
      />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("button", { name: "Worked example" }),
  ).toBeInTheDocument();
  await vi.waitFor(() => expect(api.courseModePolicyGet).toHaveBeenCalled());
  await vi.waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Show answer" }),
    ).not.toBeInTheDocument(),
  );
});
