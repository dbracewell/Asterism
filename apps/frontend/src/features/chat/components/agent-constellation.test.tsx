import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SubAgentActivity } from "../types";
import { AgentConstellation } from "./agent-constellation";

const activity = (
  executionId: string,
  overrides: Partial<SubAgentActivity> = {},
): SubAgentActivity => ({
  executionId,
  parentExecutionId: null,
  subAgentId: `agent-${executionId}`,
  name: `Agent ${executionId}`,
  modelName: null,
  depth: 1,
  status: "running",
  content: "",
  thinking: "",
  toolCalls: [],
  ...overrides,
});

const node = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-node-id="${id}"]`)!;

describe("AgentConstellation", () => {
  it("draws the main agent and sub-agents with name, model and state", () => {
    const { container } = render(
      <AgentConstellation
        mainModel="Alpha"
        activities={[
          activity("r", { name: "Researcher", modelName: "Gamma" }),
          activity("w", {
            name: "Writer",
            parentExecutionId: "r",
            status: "completed",
          }),
          activity("x", { name: "Checker", status: "error" }),
        ]}
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "Delegation graph: main agent and 3 sub-agents, 1 running, 1 failed",
      }),
    ).toBeInTheDocument();
    expect(node(container, "main")).toHaveTextContent("Main agentAlpha");
    expect(node(container, "r")).toHaveAttribute("data-state", "running");
    expect(node(container, "r")).toHaveTextContent("ResearcherGamma");
    expect(node(container, "r").querySelector("title")).toHaveTextContent(
      "Researcher · Gamma · Running",
    );
    // Live agents glow in flare; settled ones use star (primary).
    expect(node(container, "r").querySelector(".fill-flare")).not.toBeNull();
    expect(node(container, "w").querySelector(".fill-primary")).not.toBeNull();
    expect(node(container, "w").querySelector(".fill-flare\\/25")).toBeNull();
    expect(
      node(container, "x").querySelector(".fill-destructive"),
    ).not.toBeNull();
    const edges = [
      ...container.querySelectorAll('[data-slot="constellation-edge"]'),
    ].map((edge) => [
      edge.getAttribute("data-from"),
      edge.getAttribute("data-to"),
      edge.getAttribute("data-state"),
    ]);
    expect(edges).toEqual([
      ["main", "r", "running"],
      ["main", "x", "error"],
      ["r", "w", "completed"],
    ]);
  });

  it("settles a node when its activity completes", () => {
    const { container, rerender } = render(
      <AgentConstellation activities={[activity("r")]} />,
    );
    expect(node(container, "main")).toHaveAttribute("data-state", "running");
    rerender(
      <AgentConstellation
        activities={[activity("r", { status: "completed" })]}
      />,
    );
    expect(node(container, "r")).toHaveAttribute("data-state", "completed");
    expect(node(container, "main")).toHaveAttribute("data-state", "completed");
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("renders untrusted names as text", () => {
    const { container } = render(
      <AgentConstellation
        activities={[activity("r", { name: "<img src=x onerror=alert(1)>" })]}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(node(container, "r").querySelector("title")).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
  });
});
