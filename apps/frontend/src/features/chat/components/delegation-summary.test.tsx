import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { record } from "@/test/delegation-records";
import { DelegationSummary } from "./delegation-summary";

vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

const records = [
  record("lead", {
    name: "Researcher",
    output: "Found <b>two</b> catalogues",
    tool_calls: [
      {
        id: "1",
        type: "function",
        function: { name: "web_search", arguments: "{}" },
      },
    ],
  }),
  record("child", {
    name: "Checker",
    parent_execution_id: "lead",
    depth: 2,
    status: "error",
    error: "Timed out",
    ended_at_ms: 4_000,
  }),
];

describe("DelegationSummary", () => {
  it("starts collapsed as one summary line", () => {
    render(<DelegationSummary records={records} />);
    const trigger = screen.getByRole("button", {
      name: "2 agents · 3.0 s · 1 tool · 1 failed",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: /Delegation graph/ })).toBeNull();
    expect(screen.queryByText("Timed out")).toBeNull();
  });

  it("expands to the graph and each agent's timeline and output", async () => {
    render(<DelegationSummary records={records} mainModel="Alpha" />);
    await userEvent.click(screen.getByRole("button", { name: /^2 agents/ }));
    expect(
      screen.getByRole("list", {
        name: "Delegation graph: main agent and 2 sub-agents, 1 failed",
      }),
    ).toBeInTheDocument();
    const agents = within(
      screen.getByRole("list", { name: "Delegated agents" }),
    );
    const lead = screen.getByTestId("delegation-lead");
    expect(lead).toHaveTextContent("Researcher");
    expect(lead).toHaveTextContent("Gamma");
    expect(lead).toHaveTextContent("Done · 1.0 s");
    expect(lead).toHaveTextContent("Found <b>two</b> catalogues");
    expect(
      within(lead).getByRole("button", { name: "1 tool call" }),
    ).toBeInTheDocument();
    const child = screen.getByTestId("delegation-child");
    expect(child).toHaveTextContent("Depth 2");
    expect(child).toHaveTextContent("Failed · 3.0 s");
    expect(child).toHaveTextContent("Timed out");
    // History must not announce old failures as live alerts.
    expect(agents.queryByRole("alert")).toBeNull();
  });
});
