import type { CapabilityManifest, Message } from "@/lib/client";
import { record } from "@/test/delegation-records";
import { expect, it } from "vitest";
import { manifestSummary, turnCapabilities } from "./capability-manifest";

const manifest = (
  entries: CapabilityManifest["entries"] = [],
  extra: Partial<CapabilityManifest> = {},
): CapabilityManifest => ({
  agent_id: "agent",
  agent_name: "Agent",
  is_sub_agent: false,
  configuration_revision: 1,
  model_supports_tools: true,
  entries,
  ...extra,
});

const step = (extra: Partial<Message> = {}): Message =>
  ({
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    status: "completed",
    created_at: 0,
    ...extra,
  }) as Message;

it("summarizes entry counts by kind", () => {
  expect(
    manifestSummary(
      manifest([
        { kind: "tool", id: "web_search", grants: ["admin_policy"] },
        { kind: "tool", id: "sub_agent", grants: ["admin_policy"] },
        { kind: "file", id: "f", grants: ["chat_attachment"] },
      ]),
    ),
  ).toBe("2 tools · 1 file");
  expect(manifestSummary(manifest())).toBe("Nothing");
});

it("lists the main agent, then each sub-agent with its own recorded manifest", () => {
  const main = manifest([
    { kind: "tool", id: "sub_agent", grants: ["project_selection"] },
  ]);
  const child = manifest([], { is_sub_agent: true, agent_name: "Child" });
  const agents = turnCapabilities([
    step({
      execution: {
        capabilities: main,
        model: { name: "Alpha" },
      } as Message["execution"],
      delegations: [
        record("one", { name: "Researcher", capabilities: child }),
        record("two", { name: "Failed early", depth: 2 }),
      ],
    }),
  ]);
  expect(agents.map((agent) => [agent.name, agent.manifest])).toEqual([
    ["Main agent", main],
    ["Researcher", child],
    ["Failed early", null],
  ]);
  expect(agents[0].model).toBe("Alpha");
  expect(agents[2].depth).toBe(2);
});

it("returns nothing when the turn recorded no manifest", () => {
  expect(turnCapabilities([step({ delegations: [record("one")] })])).toEqual(
    [],
  );
  expect(turnCapabilities([step({ role: "user" })])).toEqual([]);
});
