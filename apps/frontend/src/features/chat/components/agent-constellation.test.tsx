import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
  toolResults: [],
  ...overrides,
});

vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

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
    const list = screen.getByRole("list", {
      name: "Delegation graph: main agent and 3 sub-agents, 1 running, 1 failed",
    });
    // The text equivalent, parents before children, with who delegated whom.
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Main agent, Alpha, running",
      "Researcher, Gamma, running, delegated by Main agent",
      "Checker, failed, delegated by Main agent",
      "Writer, done, delegated by Researcher",
    ]);
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
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

  it("expands a node's details by keyboard and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(
      <AgentConstellation
        activities={[
          activity("r", {
            name: "Researcher",
            modelName: "Gamma",
            status: "completed",
            content: "Found Gaia",
            toolCalls: [
              {
                id: "t",
                type: "function",
                function: { name: "web_search", arguments: "{}" },
              },
            ],
            toolResults: [
              {
                tool_call: {
                  id: "t",
                  type: "function",
                  function: { name: "web_search", arguments: "{}" },
                },
                content: "Gaia",
                raw_result: { text: "Gaia" },
                is_empty: false,
              },
            ],
          }),
          activity("x", { name: "Checker", status: "error", error: "Boom" }),
        ]}
      />,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: /^Main agent/ })).toHaveFocus();
    await user.tab();
    const researcher = screen.getByRole("button", { name: /^Researcher/ });
    expect(researcher).toHaveFocus();
    expect(researcher).toHaveAttribute("aria-expanded", "false");
    expect(researcher).not.toHaveAttribute("aria-controls");

    await user.keyboard("{Enter}");
    expect(researcher).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "Researcher details" });
    expect(researcher).toHaveAttribute("aria-controls", details.id);
    expect(details).toHaveTextContent("Gamma · Done");
    expect(details).toHaveTextContent("Found Gaia");
    await user.click(
      within(details).getByRole("button", { name: "1 tool call" }),
    );
    expect(
      within(details).getByRole("button", { name: /^web_search/ }),
    ).toHaveTextContent("Done");

    // One node at a time.
    await user.click(screen.getByRole("button", { name: /^Checker/ }));
    expect(
      screen.queryByRole("region", { name: "Researcher details" }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "Checker details" }),
    ).toHaveTextContent("Boom");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: /details$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Checker/ })).toHaveFocus();

    await user.keyboard(" ");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: /^Checker/ })).toHaveFocus();
  });

  it("lists the agents folded into the overflow node", async () => {
    const user = userEvent.setup();
    render(
      <AgentConstellation
        activities={Array.from({ length: 18 }, (_, index) =>
          activity(`n${index}`, { name: `Agent ${index}` }),
        )}
      />,
    );
    const overflow = screen.getByRole("button", {
      name: "3 more agents, 3 running",
    });
    await user.click(overflow);
    const details = screen.getByRole("region", { name: "+3 more details" });
    expect(within(details).getAllByRole("listitem")).toHaveLength(3);
    expect(details).toHaveTextContent("Agent 17 · Running");
  });

  it("summarizes the main agent's direct delegations", async () => {
    const user = userEvent.setup();
    render(
      <AgentConstellation
        mainModel="Alpha"
        activities={[
          activity("a", { name: "Researcher" }),
          activity("b", { name: "Writer", parentExecutionId: "a" }),
          activity("c", { name: "Checker" }),
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Main agent/ }));
    expect(
      screen.getByRole("region", { name: "Main agent details" }),
    ).toHaveTextContent("Alpha · Delegated to Researcher, Checker");
  });
});
