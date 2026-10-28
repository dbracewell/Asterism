import { describe, expect, it } from "vitest";
import { record } from "@/test/delegation-records";
import {
  activitiesFromRecords,
  delegationSteps,
  delegationSummary,
} from "./delegations";

const call = (id: string, name = "web_search") => ({
  id,
  type: "function" as const,
  function: { name, arguments: '{"q":"vega"}' },
});

describe("delegation records", () => {
  it("summarizes agents, wall time, tools and failures", () => {
    expect(
      delegationSummary([
        record("a", { tool_calls: [call("1"), call("2")] }),
        record("b", {
          started_at_ms: 1_500,
          ended_at_ms: 13_000,
          status: "error",
          tool_calls: [call("3")],
        }),
        record("c", { status: "cancelled" }),
      ]),
    ).toBe("3 agents · 12.0 s · 3 tools · 1 failed · 1 cancelled");
    expect(delegationSummary([record("a")])).toBe("1 agent · 1.0 s · 0 tools");
  });

  it("maps records onto the live activity shape", () => {
    expect(
      activitiesFromRecords([
        record("child", {
          parent_execution_id: "lead",
          depth: 2,
          output: "Answer",
          error: "Partial",
          status: "running",
          tool_calls: [call("1")],
        }),
      ]),
    ).toEqual([
      {
        executionId: "child",
        parentExecutionId: "lead",
        subAgentId: "agent-child",
        name: "Agent child",
        modelName: "Gamma",
        depth: 2,
        status: "cancelled",
        content: "Answer",
        thinking: "",
        toolCalls: [call("1")],
        error: "Partial",
      },
    ]);
  });

  it("builds each agent's steps from its recorded calls and results", () => {
    const steps = delegationSteps(
      record("a", {
        tool_calls: [call("ok"), call("bad", "read_file")],
        tool_results: [
          {
            tool_call: call("ok"),
            content: "Vega is in Lyra",
            raw_result: { text: "Vega is in Lyra" },
            is_empty: false,
          },
          {
            tool_call: call("bad", "read_file"),
            content: "",
            raw_result: { error: "missing" },
            is_empty: true,
          },
        ],
      }),
    );
    expect(
      steps.map((step) =>
        step.kind === "tool" ? [step.name, step.status, step.result] : [],
      ),
    ).toEqual([
      ["web_search", "succeeded", "Vega is in Lyra"],
      ["read_file", "failed", "missing"],
    ]);
  });
});
