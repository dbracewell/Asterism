import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AgentTimelineStep } from "../lib/agent-timeline";
import { AgentTimeline, timelineSummary } from "./agent-timeline";

const longToken = "unbrokentext".repeat(60);

const steps: AgentTimelineStep[] = [
  { kind: "thinking", id: "t", text: "Consider the sources" },
  {
    kind: "tool",
    id: "a",
    name: "web_search",
    arguments: JSON.stringify({ query: longToken }),
    status: "succeeded",
    result: '{"hits":2}',
    durationMs: 1200,
  },
  {
    kind: "tool",
    id: "b",
    name: "read_file",
    arguments: '{"path":"<img src=x onerror=alert(1)>"}',
    status: "failed",
    result: "Tool failed with exception: missing",
  },
];

describe("AgentTimeline", () => {
  it("renders nothing without steps", () => {
    const { container } = render(<AgentTimeline steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarizes the steps and expands to an ordered step list", async () => {
    const user = userEvent.setup();
    render(<AgentTimeline steps={steps} />);
    const trigger = screen.getByRole("button", {
      name: "Thinking · 2 tool calls · 1 failed",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    const list = screen.getByRole("list", { name: "Agent steps" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Consider the sources");
    expect(items[1]).toHaveTextContent("web_search");
    expect(items[1]).toHaveTextContent("Done · 1.2 s");
    expect(items[2]).toHaveTextContent("Failed");
  });

  it("truncates long arguments in the row and shows them in full on expansion", async () => {
    const user = userEvent.setup();
    render(<AgentTimeline steps={steps} defaultOpen />);
    const row = screen.getByRole("button", { name: /^web_search/ });
    expect(row.textContent!.length).toBeLessThan(longToken.length);
    expect(row).toHaveTextContent("…");
    await user.click(row);
    expect(
      screen.getByRole("region", { name: "Arguments" }).textContent,
    ).toContain(longToken);
    expect(screen.getByRole("region", { name: "Result" })).toHaveTextContent(
      '"hits": 2',
    );
  });

  it("shows failures as an error and renders untrusted arguments as text", async () => {
    const user = userEvent.setup();
    const { container } = render(<AgentTimeline steps={steps} defaultOpen />);
    await user.click(screen.getByRole("button", { name: /^read_file/ }));
    expect(screen.getByRole("region", { name: "Error" })).toHaveTextContent(
      "Tool failed with exception: missing",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("region", { name: "Arguments" })).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("reports the running tool while streaming", () => {
    const running: AgentTimelineStep[] = [
      {
        kind: "tool",
        id: "a",
        name: "web_search",
        arguments: "{}",
        status: "running",
      },
    ];
    expect(timelineSummary(running)).toBe("Running web_search");
    render(<AgentTimeline steps={running} streaming defaultOpen />);
    expect(
      screen.getByRole("button", { name: "Running web_search" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /^web_search/ }),
    ).toHaveTextContent("Running");
  });

  it("keeps tool rows keyboard operable", async () => {
    const user = userEvent.setup();
    render(<AgentTimeline steps={steps.slice(1, 2)} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "1 tool call" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.tab();
    const row = screen.getByRole("button", { name: /^web_search/ });
    expect(row).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-expanded", "true");
  });
});
