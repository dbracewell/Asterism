import { TooltipProvider } from "@/components/ui/tooltip";
import type { StreamingMessage } from "@/features/chat/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MessageActions } from "./message-actions";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  messageUpdateMutation: () => ({ mutationFn: mocks.update }),
}));
vi.mock("@/features/chat/components/verification/verify-dialog", () => ({
  VerifyAction: () => null,
}));

const message = (extra: Partial<StreamingMessage>): StreamingMessage => ({
  id: "m",
  role: "assistant",
  content: "Answer",
  status: "completed",
  created_at: 0,
  ...extra,
});

function setup(answer: StreamingMessage, branch?: StreamingMessage) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <MessageActions
          chatId="chat"
          message={answer}
          branch={branch}
          isProcessing={false}
          canRegenerate
          onRegenerate={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("switches the hidden tool step's versions from the visible answer (US-90.2)", async () => {
  // Regenerating searched again: the second version is a tool-call step whose
  // parent is the first search; the answer under it has no versions itself.
  const search = message({
    id: "search-2",
    parent_message_id: "search-1",
    tool_calls: [],
    sibling_count: 2,
    current_sibling_index: 2,
    previous_sibling_id: "answer-1",
  });
  const user = setup(
    message({ id: "answer-2", parent_message_id: "search-2" }),
    search,
  );
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Next response version" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Previous response version" }),
  );
  expect(mocks.update.mock.calls[0][0]).toEqual({
    path: { chat_id: "chat", message_id: "search-1" },
    body: { active_child_id: "answer-1" },
  });
});

it("shows no switcher when nothing has another version", () => {
  setup(message({ id: "answer", parent_message_id: "u" }));
  expect(
    screen.queryByRole("button", { name: "Previous response version" }),
  ).toBeNull();
});
