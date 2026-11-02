import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DelegationRecord, DisagreementSummary } from "@/lib/client";
import { DelegationSummary } from "../delegation-summary";
import { DisagreementsPanel, FindDisagreements } from "./disagreements";

const mocks = vi.hoisted(() => ({
  models: vi.fn(),
  columns: vi.fn(),
  agents: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { default_model_id: "m2" } }),
}));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
}));
vi.mock("@/features/chat/components/agent-constellation", () => ({
  AgentConstellation: () => null,
}));
vi.mock("@/components/settings/model-selector", () => ({
  ModelSelector: ({
    id,
    value,
    onValueChange,
    availableModels,
  }: {
    id: string;
    value?: string;
    onValueChange: (value: string) => void;
    availableModels: { id: string; name: string }[];
  }) => (
    <select
      id={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {availableModels.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: () => mocks.models(),
  }),
  chatComparisonDisagreementsFindMutation: () => ({
    mutationFn: mocks.columns,
  }),
  chatDelegationDisagreementsFindMutation: () => ({
    mutationFn: mocks.agents,
  }),
}));

const summary: DisagreementSummary = {
  model_id: "m1",
  model_name: "Checker",
  created_at: Date.UTC(2026, 10, 2, 12),
  sources: [
    {
      key: "S1",
      kind: "agent",
      label: "Researcher",
      delegation_execution_id: "e1",
    },
    {
      key: "S2",
      kind: "agent",
      label: "Critic",
      delegation_execution_id: "e2",
      truncated: true,
    },
  ],
  disagreements: [
    {
      topic: "Cause of tides <b>",
      positions: [
        { source: "S1", claim: "The Moon's gravity." },
        { source: "S2", claim: "The wind." },
      ],
    },
  ],
  usage: {
    truncated: true,
    limit: 8,
    input_tokens: 900,
    output_tokens: 40,
    duration_ms: 2100,
  },
};

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.models.mockResolvedValue([
    { id: "m1", name: "One", available: true },
    { id: "m2", name: "Two", available: true },
  ]);
});

describe("DisagreementsPanel", () => {
  it("lists each point with every source's position, provenance and limits", async () => {
    const user = userEvent.setup();
    const onShowSource = vi.fn();
    wrap(
      <DisagreementsPanel
        summary={summary}
        stale
        onShowSource={onShowSource}
      />,
    );
    const panel = screen.getByRole("region", { name: "Disagreements" });
    expect(panel).toHaveTextContent("1 point");
    expect(panel).toHaveTextContent(
      "Compared Researcher, Critic with Checker on",
    );
    expect(panel).toHaveTextContent("900 in / 40 out tokens · 2.1 s");
    expect(within(panel).getByRole("note")).toHaveTextContent(
      "An answer changed after this summary was made.",
    );
    expect(panel).toHaveTextContent("Only the first 8 points are shown.");
    expect(panel).toHaveTextContent(
      "Only the beginning of Critic was compared.",
    );
    // Model text stays text.
    expect(within(panel).getByText("Cause of tides <b>")).toBeVisible();
    expect(panel.querySelector("b")).toBeNull();

    await user.click(
      within(panel).getByRole("button", { name: "Show Critic" }),
    );
    expect(onShowSource).toHaveBeenCalledWith(summary.sources[1]);
  });

  it("says when there is nothing to report", () => {
    wrap(
      <DisagreementsPanel
        summary={{ ...summary, disagreements: [] }}
        onShowSource={() => {}}
      />,
    );
    expect(screen.getByRole("region")).toHaveTextContent(
      "No disagreements found",
    );
  });
});

describe("FindDisagreements", () => {
  it("compares a comparison's columns with the chosen model", async () => {
    const user = userEvent.setup();
    mocks.columns.mockResolvedValue(summary);
    wrap(
      <FindDisagreements
        target={{ kind: "comparison", chatId: "chat", comparisonId: "cmp" }}
        sources={3}
        preferredModelId="m1"
        again={false}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Find disagreements" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Find disagreements" });
    expect(dialog).toHaveTextContent("Compares the 3 answers");
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Model")).toHaveValue("m1"),
    );
    await user.click(within(dialog).getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.columns.mock.calls[0][0]).toEqual({
      path: { chat_id: "chat", comparison_id: "cmp" },
      body: { model_id: "m1" },
    });
    expect(mocks.agents).not.toHaveBeenCalled();
  });

  it("shows the server's reason and stays open", async () => {
    const user = userEvent.setup();
    mocks.agents.mockRejectedValue({
      detail: "At least two agents need a finished result to compare",
    });
    wrap(
      <FindDisagreements
        target={{ kind: "delegations", chatId: "chat", messageId: "msg" }}
        sources={2}
        again
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Find disagreements again" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This replaces the previous summary.",
    );
    await user.click(await screen.findByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "At least two agents need a finished result",
    );
  });
});

const record = (
  execution_id: string,
  name: string,
  extra: Partial<DelegationRecord> = {},
): DelegationRecord =>
  ({
    execution_id,
    sub_agent_id: `${execution_id}-agent`,
    name,
    depth: 1,
    status: "completed",
    started_at_ms: 0,
    ended_at_ms: 1000,
    output: `${name} output`,
    ...extra,
  }) as DelegationRecord;

describe("DelegationSummary disagreements", () => {
  it("offers a pass for two finished agents and jumps to an agent's entry", async () => {
    const user = userEvent.setup();
    wrap(
      <DelegationSummary
        records={[
          record("e1", "Researcher"),
          record("e2", "Critic"),
          record("e3", "Broken", { status: "error", output: "" }),
        ]}
        disagreements={{ chatId: "chat", messageId: "msg", summary }}
      />,
    );
    // Collapsed by default; a summary is reachable after expanding.
    await user.click(screen.getByRole("button", { name: /3 agents/ }));
    const panel = screen.getByRole("region", { name: "Disagreements" });
    expect(
      screen.getByRole("button", { name: "Find disagreements again" }),
    ).toBeVisible();
    await user.click(
      within(panel).getByRole("button", { name: "Show Critic" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("delegation-e2")).toHaveFocus(),
    );
  });

  it("offers nothing with fewer than two finished agents", async () => {
    const user = userEvent.setup();
    wrap(
      <DelegationSummary
        records={[
          record("e1", "Researcher"),
          record("e2", "Critic", { output: " " }),
        ]}
        disagreements={{ chatId: "chat", messageId: "msg" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /2 agents/ }));
    expect(
      screen.queryByRole("button", { name: /Find disagreements/ }),
    ).toBeNull();
  });
});
