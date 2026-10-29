import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubAgentActivityPanel } from "./sub-agent-activity";
import { AgentSubAgentEvent } from "../schemas";
import { SubAgentActivity, updateSubAgentActivities } from "../types";

vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

const packet = (
  executionId: string,
  name: string,
  depth: number,
  event: AgentSubAgentEvent["event"],
) => ({
  type: "sub_agent" as const,
  execution_id: executionId,
  sub_agent_id: `agent-${executionId}`,
  sub_agent_name: name,
  depth,
  event,
});

const searchCall = {
  id: "s",
  type: "function" as const,
  function: { name: "web_search", arguments: "{}" },
};

describe("sub-agent activity", () => {
  it("keeps a child running through intermediate tool steps", () => {
    let activities = updateSubAgentActivities(
      [],
      packet("one", "Researcher", 1, { type: "start" }),
    );
    activities = updateSubAgentActivities(
      activities,
      packet("one", "Researcher", 1, {
        type: "complete",
        content: "",
        thinking: "",
        tool_calls: [searchCall],
        tool_results: [
          {
            tool_call: searchCall,
            content: "Gaia",
            raw_result: { text: "Gaia" },
            is_empty: false,
          },
        ],
      }),
    );
    expect(activities[0].status).toBe("running");
    expect(activities[0].toolResults).toHaveLength(1);
    activities = updateSubAgentActivities(
      activities,
      packet("one", "Researcher", 1, {
        type: "complete",
        content: "Done",
        thinking: "",
        tool_calls: [],
        tool_results: [],
      }),
    );
    expect(activities[0]).toMatchObject({
      status: "completed",
      content: "Done",
    });
    expect(activities[0].toolResults).toHaveLength(1);
  });

  it("announces status changes politely, once each", () => {
    const base = updateSubAgentActivities(
      [],
      packet("one", "Researcher", 1, { type: "start" }),
    );
    const { container, rerender } = render(
      <SubAgentActivityPanel activities={[]} />,
    );
    const announcer = () =>
      container.querySelector('[data-slot="delegation-announcer"]')!;
    expect(announcer()).toHaveAttribute("aria-live", "polite");
    expect(announcer()).toHaveTextContent("");

    rerender(<SubAgentActivityPanel activities={base} />);
    expect(announcer()).toHaveTextContent("Researcher started.");

    const both = updateSubAgentActivities(
      base,
      packet("two", "Checker", 2, { type: "start" }),
    );
    rerender(<SubAgentActivityPanel activities={both} />);
    expect(announcer()).toHaveTextContent("Checker started.");

    const settled = updateSubAgentActivities(
      updateSubAgentActivities(
        both,
        packet("one", "Researcher", 1, {
          type: "complete",
          content: "Done",
          thinking: "",
          tool_calls: [],
          tool_results: [],
        }),
      ),
      packet("two", "Checker", 2, { type: "error", content: "Boom" }),
    );
    rerender(<SubAgentActivityPanel activities={settled} />);
    expect(announcer()).toHaveTextContent(
      "Researcher finished. Checker failed.",
    );
    // The per-card status is no longer its own live region.
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("tracks independent and nested executions through terminal states", () => {
    let activities: SubAgentActivity[] = [];
    activities = updateSubAgentActivities(
      activities,
      packet("one", "Researcher", 1, { type: "start" }),
    );
    activities = updateSubAgentActivities(
      activities,
      packet("two", "Reviewer", 2, {
        type: "delta",
        content: "Reviewing evidence",
        thinking: "Cross-checking",
      }),
    );
    activities = updateSubAgentActivities(
      activities,
      packet("one", "Researcher", 1, {
        type: "complete",
        content: "Research complete",
        thinking: "",
        tool_calls: [],
        tool_results: [],
      }),
    );
    activities = updateSubAgentActivities(
      activities,
      packet("two", "Reviewer", 2, {
        type: "error",
        content: "Provider timed out",
      }),
    );

    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      executionId: "one",
      status: "completed",
      content: "Research complete",
    });
    expect(activities[1]).toMatchObject({
      executionId: "two",
      depth: 2,
      status: "error",
      error: "Provider timed out",
    });
  });

  it("renders progress, tools, completion, and errors accessibly", () => {
    render(
      <SubAgentActivityPanel
        activities={[
          {
            executionId: "running",
            parentExecutionId: null,
            subAgentId: "agent-running",
            name: "Researcher",
            modelName: "Gamma",
            depth: 1,
            status: "running",
            content: "Found an initial result",
            thinking: "Checking sources",
            toolCalls: [
              {
                id: "tool-1",
                type: "function",
                function: { name: "web_search", arguments: '{"q":"news"}' },
              },
            ],
            toolResults: [],
          },
          {
            executionId: "done",
            parentExecutionId: null,
            modelName: null,
            subAgentId: "agent-done",
            name: "Writer",
            depth: 2,
            status: "completed",
            content: "Draft ready",
            thinking: "",
            toolCalls: [],
            toolResults: [],
          },
          {
            executionId: "failed",
            parentExecutionId: null,
            modelName: null,
            subAgentId: "agent-failed",
            name: "Reviewer",
            depth: 1,
            status: "error",
            content: "",
            thinking: "",
            toolCalls: [],
            toolResults: [],
            error: "Provider timed out",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Sub-agent activity" }),
    ).toBeVisible();
    expect(
      screen.getByRole("list", { name: /^Delegation graph: main agent and 3/ }),
    ).toBeVisible();
    const researcher = screen.getByTestId("sub-agent-running");
    expect(researcher).toHaveTextContent("Researcher");
    expect(researcher).toHaveTextContent("Gamma");
    expect(screen.getByText("Working")).toBeVisible();
    expect(screen.getByText(/web_search/)).toBeVisible();
    expect(screen.getByText("Completed")).toBeVisible();
    expect(screen.getByText("Depth 2")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Provider timed out");
  });
});
