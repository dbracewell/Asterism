import { describe, expect, it } from "vitest";
import type { SubAgentActivity } from "../types";
import {
  COLUMN_WIDTH,
  columnsForWidth,
  fitLabel,
  layoutConstellation,
  MAIN_NODE_ID,
} from "./constellation-layout";

const activity = (
  executionId: string,
  overrides: Partial<SubAgentActivity> = {},
): SubAgentActivity => ({
  executionId,
  parentExecutionId: null,
  subAgentId: `agent-${executionId}`,
  name: `Agent ${executionId}`,
  modelName: `Model ${executionId}`,
  depth: 1,
  status: "running",
  content: "",
  thinking: "",
  toolCalls: [],
  ...overrides,
});

const levelOf = (layout: ReturnType<typeof layoutConstellation>, id: string) =>
  layout.nodes.find((node) => node.id === id)?.level;

describe("layoutConstellation", () => {
  it("picks columns from the measured width within fixed bounds", () => {
    expect(columnsForWidth(200)).toBe(2);
    expect(columnsForWidth(320)).toBe(2);
    expect(columnsForWidth(390)).toBe(3);
    expect(columnsForWidth(2000)).toBe(6);
  });

  it("links each delegation to its parent and bands nodes by level", () => {
    const layout = layoutConstellation(
      [
        activity("a"),
        activity("b"),
        activity("a1", { parentExecutionId: "a", depth: 2 }),
        activity("lost", { parentExecutionId: "missing", depth: 2 }),
      ],
      { width: 800, mainModel: "Alpha" },
    );
    expect(layout.nodes[0]).toMatchObject({
      id: MAIN_NODE_ID,
      kind: "main",
      model: "Alpha",
      level: 0,
    });
    expect(levelOf(layout, "a1")).toBe(2);
    // An unknown parent attaches to the main agent.
    expect(levelOf(layout, "lost")).toBe(1);
    expect(layout.edges).toEqual([
      { from: MAIN_NODE_ID, to: "a", state: "running" },
      { from: MAIN_NODE_ID, to: "b", state: "running" },
      { from: MAIN_NODE_ID, to: "lost", state: "running" },
      { from: "a", to: "a1", state: "running" },
    ]);
    const rows = [...new Set(layout.nodes.map((node) => node.y))];
    expect(rows).toHaveLength(3);
  });

  it("maps activity states to node and edge states", () => {
    const layout = layoutConstellation(
      [
        activity("done", { status: "completed" }),
        activity("broken", { status: "error" }),
      ],
      { width: 600 },
    );
    expect(layout.nodes.map((node) => [node.id, node.state])).toEqual([
      [MAIN_NODE_ID, "completed"],
      ["done", "completed"],
      ["broken", "error"],
    ]);
    expect(layout.edges.map((edge) => edge.state)).toEqual([
      "completed",
      "error",
    ]);
    const live = layoutConstellation([activity("live")], { width: 600 });
    expect(live.nodes[0].state).toBe("running");
  });

  it("wraps a wide level into rows that stay inside a narrow pane", () => {
    const width = 296;
    const layout = layoutConstellation(
      Array.from({ length: 5 }, (_, index) => activity(`n${index}`)),
      { width },
    );
    expect(layout.columns).toBe(2);
    expect(new Set(layout.nodes.map((node) => node.y)).size).toBe(4);
    for (const node of layout.nodes) {
      expect(node.x - COLUMN_WIDTH / 2).toBeGreaterThanOrEqual(0);
      expect(node.x + COLUMN_WIDTH / 2).toBeLessThanOrEqual(width);
      expect(node.y).toBeLessThan(layout.height);
    }
  });

  it("folds agents past the maximum into one overflow node", () => {
    const activities = [
      ...Array.from({ length: 12 }, (_, index) => activity(`top${index}`)),
      ...Array.from({ length: 8 }, (_, index) =>
        activity(`deep${index}`, {
          parentExecutionId: "top0",
          depth: 2,
          status: index < 3 ? "running" : "completed",
        }),
      ),
    ];
    const layout = layoutConstellation(activities, { width: 900 });
    const subAgents = layout.nodes.filter((node) => node.kind === "sub-agent");
    const overflow = layout.nodes.find((node) => node.kind === "overflow");
    expect(subAgents).toHaveLength(15);
    expect(overflow).toMatchObject({
      name: "+5 more",
      hidden: 5,
      hiddenRunning: 0,
      level: 2,
    });
    // Every drawn line has both ends on screen.
    const ids = new Set(layout.nodes.map((node) => node.id));
    expect(layout.edges).toHaveLength(15);
    for (const edge of layout.edges) {
      expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    }
  });

  it("is deterministic for the same input and width", () => {
    const activities = [
      activity("a"),
      activity("b", { parentExecutionId: "a" }),
      activity("c"),
    ];
    expect(layoutConstellation(activities, { width: 500 })).toEqual(
      layoutConstellation([...activities], { width: 500 }),
    );
  });

  it("survives a parent cycle", () => {
    const layout = layoutConstellation(
      [
        activity("x", { parentExecutionId: "y" }),
        activity("y", { parentExecutionId: "x" }),
      ],
      { width: 500 },
    );
    expect(layout.nodes.map((node) => node.id).sort()).toEqual([
      MAIN_NODE_ID,
      "x",
      "y",
    ]);
  });
});

describe("fitLabel", () => {
  it("keeps short labels and clips long ones", () => {
    expect(fitLabel("Researcher")).toBe("Researcher");
    expect(fitLabel("An extremely long sub-agent name")).toBe(
      "An extremely l…",
    );
  });
});
