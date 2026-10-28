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

describe("sub-agent activity", () => {
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
            error: "Provider timed out",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Sub-agent activity" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: /^Delegation graph: main agent and 3/ }),
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
