import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChatComparison, Message } from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ComparisonBlock } from "./comparison-block";

const { data, activate } = vi.hoisted(() => ({
  data: { current: null as unknown },
  activate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ timezone: "UTC", settings: { show_thinking: false } }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatComparisonGetOneOptions: () => ({
    queryKey: [{ _id: "chatComparisonGetOne" }],
    queryFn: async () => data.current,
  }),
  chatComparisonActivateMutation: () => ({
    mutationFn: (options: unknown) => activate(options),
  }),
  messageUpdateMutation: () => ({ mutationFn: vi.fn() }),
}));

const message = (id: string, role: string, extra: Partial<Message> = {}) =>
  ({
    id,
    role,
    content: role === "user" ? "Explain tides" : `Answer ${id}`,
    status: "completed",
    created_at: 1,
    ...extra,
  }) as Message;

const comparison = (extra: Partial<ChatComparison> = {}): ChatComparison => ({
  id: "cmp",
  chat_id: "chat",
  parent_message_id: null,
  active_index: 0,
  columns: [
    {
      index: 0,
      request: message("q0", "user"),
      replies: [message("r0", "assistant", { delegations: [] })],
      model: { name: "alpha", display_name: "Alpha" } as never,
      status: "completed",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      generation_duration_ms: 1500,
    },
    {
      index: 1,
      request: message("q1", "user"),
      replies: [message("r1", "assistant", { delegations: [{} as never] })],
      model: { name: "beta", display_name: "Beta" } as never,
      status: "completed",
      input_tokens: 90,
      output_tokens: 30,
      total_tokens: 120,
    },
    {
      index: 2,
      request: message("q2", "user"),
      replies: [],
      model: { name: "gamma", display_name: "Gamma" } as never,
      status: "pending",
    },
  ],
  ...extra,
});

beforeEach(() => {
  data.current = comparison();
  activate.mockReset();
  activate.mockResolvedValue(comparison({ active_index: 1 }));
});

function setup(stream: Message | null = null, isProcessing = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ComparisonBlock
          chatId="chat"
          comparisonId="cmp"
          stream={stream}
          isProcessing={isProcessing}
          canRegenerate
          onRegenerate={vi.fn()}
          sendJsonMessage={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

it("shows the prompt once and one column per target with usage and status", async () => {
  setup();
  const block = await screen.findByRole("region", {
    name: "Comparison of 3 answers",
  });
  expect(within(block).getAllByText("Explain tides")).toHaveLength(1);
  const alpha = within(block).getByRole("article", { name: "Alpha" });
  expect(alpha).toHaveTextContent("Answer r0");
  expect(alpha).toHaveTextContent("100 in · 20 out · 1.5 s");
  expect(within(alpha).getByText("Continuing here")).toBeInTheDocument();
  expect(
    within(alpha).queryByRole("link", { name: "Run graph" }),
  ).not.toBeInTheDocument();

  const beta = within(block).getByRole("article", { name: "Beta" });
  expect(within(beta).getByRole("link", { name: "Run graph" })).toHaveAttribute(
    "href",
    "#run-r1",
  );
  const gamma = within(block).getByRole("article", { name: "Gamma" });
  expect(within(gamma).getByText("Waiting")).toBeInTheDocument();
  expect(within(gamma).getByText("Not answered yet")).toBeInTheDocument();
  expect(
    within(gamma).getByRole("button", { name: "Continue from Gamma" }),
  ).toBeDisabled();
});

it("continues the conversation from another answered column", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(
    await screen.findByRole("button", { name: "Continue from Beta" }),
  );
  expect(activate).toHaveBeenCalledWith({
    path: { chat_id: "chat", comparison_id: "cmp" },
    body: { index: 1 },
  });
});

it("streams a live run into its own column only", async () => {
  setup(
    {
      ...message("incoming", "assistant", {
        content: "Tides follow the moon",
        status: "pending",
      }),
      comparison: { id: "cmp", column_id: "q2" },
    } as Message,
    true,
  );
  const gamma = await screen.findByRole("article", { name: "Gamma" });
  expect(gamma).toHaveTextContent("Tides follow the moon");
  expect(within(gamma).getByText("Answering…")).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Alpha" })).not.toHaveTextContent(
    "Tides follow the moon",
  );
});

it("shows each column's own prompt when the prompts differ", async () => {
  const base = comparison();
  data.current = {
    ...base,
    columns: [
      base.columns[0],
      {
        ...base.columns[1],
        request: message("q1", "user", { content: "Explain tides simply" }),
      },
    ],
  };
  setup();
  const beta = await screen.findByRole("article", { name: "Beta" });
  expect(beta).toHaveTextContent("Explain tides simply");
  expect(screen.getByRole("article", { name: "Alpha" })).toHaveTextContent(
    "Explain tides",
  );
});

it("heads before/after columns with their labels and names the model", async () => {
  const base = comparison();
  data.current = {
    ...base,
    columns: [
      {
        ...base.columns[0],
        request: message("q0", "user", { comparison_label: "Before" }),
      },
      {
        ...base.columns[1],
        model: base.columns[0].model,
        request: message("q1", "user", {
          content: "Explain tides to a ten-year-old",
          comparison_label: "After",
        }),
      },
    ],
  };
  setup();
  const after = await screen.findByRole("article", { name: "After" });
  expect(after).toHaveTextContent("Alpha");
  expect(after).toHaveTextContent("Explain tides to a ten-year-old");
  expect(
    within(after).getByRole("button", { name: "Continue from After" }),
  ).toBeEnabled();
  expect(screen.getByRole("article", { name: "Before" })).toBeInTheDocument();
});
