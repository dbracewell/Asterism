import type { Message, MessageExecution, RecordedRun } from "@/lib/client";
import { record } from "@/test/delegation-records";
import { standardLearningMode } from "@/test/learning-modes";
import { defaultPersonaProvenance } from "@/test/personas";
import { describe, expect, it } from "vitest";
import {
  agentRows,
  branchDiffChoices,
  capabilityChanges,
  textDiff,
  toolRows,
  usageRows,
} from "./run-diff";

const execution = (name: string): MessageExecution => ({
  persona: defaultPersonaProvenance,
  learning_mode: standardLearningMode,
  id: "e",
  request_message_id: "r",
  model_revision: 1,
  model: {
    id: "m",
    name,
    provider_id: "p",
    provider_name: "Provider",
    provider_type: "openai",
    available: true,
    pricing: { input_per_million: 2, output_per_million: 10 },
  },
  configuration: { id: "c", name: "Main", description: "", config_revision: 1 },
});

const call = (name: string) => ({
  id: crypto.randomUUID(),
  type: "function" as const,
  function: { name, arguments: "{}" },
});

const step = (extra: Partial<Message> = {}): Message => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content: "",
  status: "completed",
  created_at: 0,
  input_tokens: 1_000,
  output_tokens: 100,
  execution: execution("Alpha"),
  ...extra,
});

const manifest = (name: string, tools: string[]) => ({
  agent_id: crypto.randomUUID(),
  agent_name: name,
  is_sub_agent: true,
  configuration_revision: 1,
  entries: tools.map((id) => ({
    kind: "tool" as const,
    id,
    grants: ["agent_assignment" as const],
  })),
});

const run = (steps: Message[]): RecordedRun => ({
  request: {
    id: "u",
    role: "user",
    content: "Q",
    status: "completed",
    created_at: 0,
  },
  steps,
});

describe("textDiff", () => {
  it("marks added and removed words and keeps the rest", () => {
    expect(textDiff("The sky is blue", "The sky is very blue")).toEqual([
      { kind: "same", text: "The sky is " },
      { kind: "added", text: "very " },
      { kind: "same", text: "blue" },
    ]);
    expect(textDiff("same", "same")).toEqual([{ kind: "same", text: "same" }]);
    expect(textDiff("", "")).toEqual([]);
  });

  it("falls back to whole-text replacement for very long texts", () => {
    const long = Array.from({ length: 2_000 }, (_, i) => `w${i}`).join(" ");
    const other = Array.from({ length: 2_000 }, (_, i) => `x${i}`).join(" ");
    const parts = textDiff(long, other);
    expect(parts.map((part) => part.kind)).toEqual(["removed", "added"]);
  });
});

describe("run facts", () => {
  const before = run([
    step({
      tool_calls: [call("sub_agent")],
      delegations: [
        record("a", {
          name: "Researcher",
          model_name: "Gamma",
          tool_calls: [call("web_search"), call("web_search")],
          capabilities: manifest("Researcher", ["web_search"]),
        }),
      ],
    }),
    step({ content: "Old answer" }),
  ]);
  const after = run([
    step({
      execution: execution("Beta"),
      tool_calls: [call("sub_agent")],
      delegations: [
        record("b", {
          name: "Researcher",
          model_name: "Gamma",
          tool_calls: [call("web_search")],
          capabilities: manifest("Researcher", ["web_search", "fetch_url"]),
        }),
        record("c", { name: "Writer", model_name: "Delta" }),
      ],
    }),
    step({
      execution: execution("Beta"),
      content: "New answer",
      input_tokens: 500,
    }),
  ]);

  it("compares agents and their models", () => {
    expect(agentRows(before, after)).toEqual([
      {
        label: "Main agent",
        before: "Alpha",
        after: "Beta",
        changed: true,
      },
      { label: "Researcher", before: "Gamma", after: "Gamma", changed: false },
      { label: "Writer", before: "—", after: "Delta", changed: true },
    ]);
  });

  it("counts tool calls across the main agent and sub-agents", () => {
    expect(toolRows(before, after)).toEqual([
      { label: "sub_agent", before: "1", after: "1", changed: false },
      { label: "web_search", before: "2", after: "1", changed: true },
    ]);
  });

  it("compares recorded usage", () => {
    const [input, output] = usageRows(before, after);
    expect(input).toMatchObject({
      before: "2,000",
      after: "1,500",
      changed: true,
    });
    expect(output.changed).toBe(false);
  });

  it("lists capabilities one run had and the other didn't", () => {
    expect(capabilityChanges(before, after)).toEqual([
      {
        agent: "Researcher",
        added: ["tool: fetch_url"],
        removed: [],
        missing: null,
      },
    ]);
  });
});

describe("branchDiffChoices", () => {
  it("offers the branches beside the turn's first fork point", () => {
    const user = step({ role: "user", content: "Q" });
    const forked = step({
      id: "fork",
      sibling_count: 3,
      current_sibling_index: 2,
      previous_sibling_id: "first",
      next_sibling_id: "third",
    });
    const final = step({ id: "final" });
    expect(branchDiffChoices([user, forked, final])).toEqual({
      choices: [
        { messageId: "first", label: "Branch 1 of 3" },
        { messageId: "final", label: "Branch 2 of 3 (this one)" },
        { messageId: "third", label: "Branch 3 of 3" },
      ],
      current: 1,
    });
    expect(branchDiffChoices([user, final])).toBeNull();
  });
});
