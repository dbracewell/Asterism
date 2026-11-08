import { expect, it } from "vitest";
import { generalDelegationState } from "./general-delegation";

const agent = (name: string, model_available = true) => ({
  id: name,
  name,
  model_id: "m",
  model_available,
});
const set = (
  agents: ReturnType<typeof agent>[],
  delegation_allowed = true,
) => ({
  revision: 1,
  agents,
  delegation_allowed,
});
const tools = { supports_tools: true };

it("shows nothing until sub-agents are chosen", () => {
  expect(generalDelegationState(undefined, tools)).toEqual({ kind: "none" });
  expect(generalDelegationState(set([]), tools)).toEqual({ kind: "none" });
});

it("lists only targets whose fixed model is available", () => {
  expect(
    generalDelegationState(set([agent("A"), agent("B", false)]), tools),
  ).toEqual({ kind: "available", names: ["A"] });
});

it("explains each server-side block", () => {
  expect(generalDelegationState(set([agent("A")], false), tools)).toMatchObject(
    { kind: "blocked", reason: expect.stringMatching(/administrator/) },
  );
  for (const model of [undefined, {}, { supports_tools: null }])
    expect(generalDelegationState(set([agent("A")]), model)).toMatchObject({
      kind: "blocked",
      reason: expect.stringMatching(/doesn't support tools/),
    });
  expect(generalDelegationState(set([agent("A", false)]), tools)).toMatchObject(
    {
      kind: "blocked",
      reason: expect.stringMatching(/available model/),
    },
  );
});
