import {
  ApiClient,
  type ChatInfo,
  type HintLevel,
  type LearningModeCatalog,
} from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatHintControls } from "./chat-hint-controls";

const { api, raised } = vi.hoisted(() => ({
  api: { learningModeGetMany: vi.fn() },
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
  ],
};

beforeEach(() => {
  api.learningModeGetMany.mockReset();
  raised.mockReset();
  ApiClient.__registry.set(api as never);
  api.learningModeGetMany.mockResolvedValue({ data: catalog });
});

function info(learning_mode: ChatInfo["learning_mode"], hint_level: HintLevel) {
  return { id: "chat", learning_mode, hint_level } as ChatInfo;
}

function Harness({
  mode = "tutor",
  level = "none",
  disabled = false,
}: {
  mode?: ChatInfo["learning_mode"];
  level?: HintLevel;
  disabled?: boolean;
}) {
  const [reset, setReset] = useState(false);
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ChatHintControls
        info={info(mode, level)}
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

it("disables every control while busy", async () => {
  render(<Harness level="nudge" disabled />);
  await screen.findByRole("group", { name: "Hint controls" });
  for (const button of screen.getAllByRole("button")) {
    expect(button).toBeDisabled();
  }
});
