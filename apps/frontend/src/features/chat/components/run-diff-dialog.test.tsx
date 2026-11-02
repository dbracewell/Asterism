import { ApiClient, type Message, type RecordedRun } from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { RunDiffDialog } from "./run-diff-dialog";

const { api } = vi.hoisted(() => ({ api: { chatRunGet: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const attack = "<img src=x onerror=alert(1)>";

const run = (answer: string, tool: string): RecordedRun => ({
  request: {
    id: "u",
    role: "user",
    content: "Q",
    status: "completed",
    created_at: 0,
  },
  steps: [
    {
      id: `${answer}-1`,
      role: "assistant",
      content: "",
      status: "completed",
      created_at: 0,
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: tool, arguments: "{}" },
        },
      ],
    } as Message,
    {
      id: `${answer}-2`,
      role: "assistant",
      content: answer,
      status: "completed",
      created_at: 0,
    } as Message,
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.chatRunGet.mockImplementation(({ path }) =>
    Promise.resolve({
      data:
        path.message_id === "before"
          ? run("Tides follow the moon", "web_search")
          : run(`Tides follow the moon and sun ${attack}`, "fetch_url"),
    }),
  );
});

it("loads both runs when opened and shows what changed", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RunDiffDialog
        chatId="chat"
        choices={[
          { messageId: "before", label: "Original" },
          { messageId: "after", label: "Fork" },
        ]}
      />
    </QueryClientProvider>,
  );
  expect(api.chatRunGet).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Diff" }));
  const dialog = screen.getByRole("dialog", { name: "Run diff" });
  const answer = await within(dialog).findByLabelText("Answer changes");
  expect(answer.querySelector("ins")).toHaveTextContent(`and sun ${attack}`);
  // Answers are untrusted: plain text, never markup.
  expect(answer.querySelector("img")).toBeNull();

  const tools = within(dialog).getByRole("table", { name: "Tools called" });
  const rows = within(tools).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toEqual([
    "OriginalFork",
    "fetch_url01 (changed)",
    "web_search10 (changed)",
  ]);
  expect(api.chatRunGet).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { chat_id: "chat", message_id: "before" },
    }),
  );
});

it("renders nothing without two runs to compare", () => {
  const { container } = render(
    <RunDiffDialog chatId="chat" choices={[{ messageId: "a", label: "A" }]} />,
  );
  expect(container).toBeEmptyDOMElement();
});
