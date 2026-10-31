import type { ComparisonColumn, Message } from "@/lib/client";
import { describe, expect, it } from "vitest";
import { comparePayload } from "../components/compare-targets";
import {
  columnLabel,
  groupTranscript,
  parseComparisonTag,
  runGraphReply,
  toggleTarget,
  usageText,
} from "./comparison";

const message = (id: string, role: string, extra: Partial<Message> = {}) =>
  ({
    id,
    role,
    content: id,
    status: "completed",
    created_at: 1,
    ...extra,
  }) as Message;

const column = (extra: Partial<ComparisonColumn> = {}): ComparisonColumn => ({
  index: 0,
  request: message("q", "user"),
  replies: [],
  status: "completed",
  ...extra,
});

describe("groupTranscript", () => {
  it("folds a comparison turn and its active column's replies into one item", () => {
    const items = groupTranscript([
      message("u1", "user"),
      message("a1", "assistant"),
      message("u2", "user", { comparison_id: "cmp" }),
      message("a2", "assistant"),
      message("a3", "assistant"),
      message("u3", "user"),
      message("a4", "assistant"),
    ]);
    expect(
      items.map((item) =>
        item.kind === "comparison"
          ? `comparison:${item.comparisonId}`
          : `${item.message.id}@${item.index}`,
      ),
    ).toEqual(["u1@0", "a1@1", "comparison:cmp", "u3@5", "a4@6"]);
  });
});

describe("comparison helpers", () => {
  it("chooses at most three targets and toggles them off", () => {
    expect(toggleTarget([], "a")).toEqual(["a"]);
    expect(toggleTarget(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleTarget(["a", "b"], "a")).toEqual(["b"]);
  });

  it("requires two models before a comparison send", () => {
    expect(comparePayload([])).toEqual({});
    expect(() => comparePayload(["a"])).toThrow(/at least two/);
    expect(comparePayload(["a", "b"])).toEqual({
      compare: [{ model_id: "a" }, { model_id: "b" }],
    });
  });

  it("reads only well-formed packet tags", () => {
    expect(parseComparisonTag({ id: "c", column_id: "m" })).toEqual({
      id: "c",
      column_id: "m",
    });
    expect(parseComparisonTag({ id: "c" })).toBeUndefined();
    expect(parseComparisonTag(null)).toBeUndefined();
  });

  it("labels columns by target model, falling back to the recorded run", () => {
    expect(
      columnLabel(
        column({
          model: { name: "gpt", display_name: "GPT" } as never,
        }),
      ),
    ).toBe("GPT");
    expect(
      columnLabel(
        column({
          replies: [
            message("r", "assistant", {
              execution: { model: { name: "Removed model" } } as never,
            }),
          ],
        }),
      ),
    ).toBe("Removed model");
    expect(columnLabel(column())).toBe("Unavailable model");
  });

  it("summarises usage and finds the run graph", () => {
    expect(usageText(column())).toBeNull();
    expect(
      usageText(
        column({
          input_tokens: 1200,
          output_tokens: 34,
          total_tokens: 1234,
          generation_duration_ms: 2500,
        }),
      ),
    ).toBe("1,200 in · 34 out · 2.5 s");
    const delegated = message("r2", "assistant", {
      delegations: [{} as never],
    });
    expect(
      runGraphReply(
        column({ replies: [message("r1", "assistant"), delegated] }),
      ),
    ).toBe(delegated);
  });
});
