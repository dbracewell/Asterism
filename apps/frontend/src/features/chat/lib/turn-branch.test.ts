import type { Message } from "@/lib/client";
import { expect, it } from "vitest";
import { turnBranchStep } from "./turn-branch";

const step = (id: string, extra: Partial<Message> = {}): Message =>
  ({
    id,
    role: "assistant",
    content: "",
    status: "completed",
    ...extra,
  }) as Message;

it("is the answer itself when it holds the versions", () => {
  const answer = step("answer", { sibling_count: 2 });
  expect(
    turnBranchStep(answer, [step("search", { tool_calls: [] }), answer]),
  ).toBe(answer);
});

it("is the hidden tool step holding the versions after a re-run searched again", () => {
  const search = step("search", { sibling_count: 2, tool_calls: [] });
  const answer = step("answer");
  expect(turnBranchStep(answer, [step("first"), search, answer])).toBe(search);
});

it("is the nearest branched step when several steps have versions", () => {
  const first = step("first", { sibling_count: 3, tool_calls: [] });
  const second = step("second", { sibling_count: 2, tool_calls: [] });
  const answer = step("answer");
  expect(turnBranchStep(answer, [first, second, answer])).toBe(second);
});

it("is the answer when nothing in the turn has versions", () => {
  const answer = step("answer");
  expect(turnBranchStep(answer, [step("search"), answer])).toBe(answer);
  expect(turnBranchStep(answer, null)).toBe(answer);
});
