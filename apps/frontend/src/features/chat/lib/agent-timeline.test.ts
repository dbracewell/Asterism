import type { Message, ToolResult } from "@/lib/client";
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatPayload,
  messageTimelineSteps,
  summarizeArguments,
  toolResultStatus,
} from "./agent-timeline";

const call = (id: string, name = "web_search", args = '{"query":"orion"}') => ({
  id,
  type: "function" as const,
  function: { name, arguments: args },
});

const result = (
  id: string,
  overrides: Partial<ToolResult> = {},
): ToolResult => ({
  content: "found",
  raw_result: { hits: 1 },
  is_empty: false,
  tool_call: call(id),
  ...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  role: "assistant",
  content: "",
  status: "completed",
  created_at: 0,
  ...overrides,
});

describe("toolResultStatus", () => {
  it("distinguishes success, failure, denial and empty results", () => {
    expect(toolResultStatus(result("a"))).toBe("succeeded");
    expect(
      toolResultStatus(
        result("a", {
          content: '{"error":"boom"}',
          raw_result: { error: "Tool failed with exception: boom" },
          is_empty: true,
        }),
      ),
    ).toBe("failed");
    expect(
      toolResultStatus(
        result("a", {
          content:
            "Tool 'a - web_search' was not authorized for use by the user. Proceed.",
          raw_result: null,
          is_empty: true,
        }),
      ),
    ).toBe("denied");
    expect(
      toolResultStatus(result("a", { raw_result: null, is_empty: true })),
    ).toBe("empty");
  });
});

describe("summarizeArguments", () => {
  it("renders object arguments as key/value pairs", () => {
    expect(summarizeArguments('{"query":"orion","limit":3}')).toBe(
      "query: orion, limit: 3",
    );
    expect(summarizeArguments('{"filter":{"kind":"star"}}')).toBe(
      'filter: {"kind":"star"}',
    );
  });

  it("is empty for missing arguments and keeps non-JSON text", () => {
    expect(summarizeArguments("")).toBe("");
    expect(summarizeArguments("{}")).toBe("");
    expect(summarizeArguments("raw\n  text")).toBe("raw text");
  });

  it("truncates long arguments to one short line", () => {
    const summary = summarizeArguments(
      JSON.stringify({ input: "x".repeat(500) }),
    );
    expect(summary).toHaveLength(80);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("formatting", () => {
  it("pretty-prints JSON payloads and leaves text alone", () => {
    expect(formatPayload('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatPayload("<b>not json</b>")).toBe("<b>not json</b>");
  });

  it("formats durations by magnitude", () => {
    expect(formatDuration(42)).toBe("42 ms");
    expect(formatDuration(1530)).toBe("1.5 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});

describe("messageTimelineSteps", () => {
  it("orders reasoning before tool calls and matches results by call id", () => {
    const steps = messageTimelineSteps(
      message({
        thinking: "Plan the search",
        tool_calls: [call("a"), call("b", "read_file", "{}")],
        tool_call_results: [
          result("b", {
            tool_call: call("b", "read_file", "{}"),
            raw_result: { error: "missing" },
            is_empty: true,
          }),
          result("a"),
        ],
      }),
      {
        showThinking: true,
        timings: { a: { startedAt: 1000, endedAt: 2500 } },
      },
    );
    expect(steps).toEqual([
      { kind: "thinking", id: "m1:thinking", text: "Plan the search" },
      expect.objectContaining({
        id: "a",
        status: "succeeded",
        result: "found",
        durationMs: 1500,
      }),
      expect.objectContaining({
        id: "b",
        name: "read_file",
        status: "failed",
        result: "missing",
        durationMs: undefined,
      }),
    ]);
  });

  it("omits reasoning when thinking is hidden but keeps tool steps", () => {
    const steps = messageTimelineSteps(
      message({ thinking: "secret plan", tool_calls: [call("a")] }),
      { showThinking: false },
    );
    expect(steps.map((step) => step.kind)).toEqual(["tool"]);
  });

  it("marks unanswered calls running while streaming and empty once settled", () => {
    const streaming = messageTimelineSteps(
      message({ status: "pending", tool_calls: [call("a")] }),
      { showThinking: true, timings: { a: { startedAt: 1 } } },
    );
    expect(streaming[0]).toMatchObject({
      status: "running",
      durationMs: undefined,
    });
    const settled = messageTimelineSteps(
      message({ status: "cancelled", tool_calls: [call("a")] }),
      { showThinking: true },
    );
    expect(settled[0]).toMatchObject({ status: "empty", result: undefined });
  });

  it("has no steps for a plain reply or blank reasoning", () => {
    expect(
      messageTimelineSteps(message({ thinking: "  " }), { showThinking: true }),
    ).toEqual([]);
  });
});
