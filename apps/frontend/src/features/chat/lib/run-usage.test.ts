import type { Message, MessageExecution } from "@/lib/client";
import { record } from "@/test/delegation-records";
import { defaultPersonaProvenance } from "@/test/personas";
import { standardLearningMode } from "@/test/learning-modes";
import { describe, expect, it } from "vitest";
import {
  formatCost,
  runUsage,
  turnStepsEndingAt,
  usageSummary,
} from "./run-usage";

const PRICE = { input_per_million: 2, output_per_million: 10 };

const execution = (
  model: Partial<MessageExecution["model"]> = {},
): MessageExecution => ({
  persona: defaultPersonaProvenance,
  learning_mode: standardLearningMode,
  id: "e",
  request_message_id: "r",
  model_revision: 1,
  model: {
    id: "model",
    name: "Alpha",
    provider_id: "p",
    provider_name: "Provider",
    provider_type: "openai",
    available: true,
    pricing: PRICE,
    ...model,
  },
  configuration: { id: "c", name: "Main", description: "", config_revision: 1 },
});

const step = (extra: Partial<Message> = {}): Message => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content: "",
  status: "completed",
  created_at: 0,
  input_tokens: 1_000,
  output_tokens: 100,
  execution: execution(),
  ...extra,
});

describe("run usage", () => {
  it("totals main-agent steps and delegations with recorded prices", () => {
    const usage = runUsage([
      step({
        tool_calls: [],
        delegations: [
          record("child", {
            model_name: "Gamma",
            provider_type: "openai",
            pricing: { input_per_million: 1, output_per_million: 4 },
            steps: [
              { input_tokens: 500, output_tokens: 50 },
              { input_tokens: 700, output_tokens: 70 },
            ],
          }),
        ],
      }),
      step({ input_tokens: 2_000, output_tokens: 200 }),
    ]);
    expect([usage.inputTokens, usage.outputTokens]).toEqual([4_200, 420]);
    // Main: 3000 × $2 + 300 × $10 = $0.009; child: 1200 × $1 + 120 × $4 = $0.00168.
    expect(usage.cost).toBeCloseTo(0.01068, 8);
    expect(usage.partialCost).toBe(false);
    const [main, child] = usage.agents;
    expect(main).toMatchObject({ name: "Main agent", model: "Alpha" });
    expect(main.steps.map((row) => row.cost)).toEqual([0.003, 0.006]);
    expect(child).toMatchObject({
      name: "Agent child",
      model: "Gamma",
      depth: 1,
    });
    expect(child.cost).toBeCloseTo(0.00168, 8);
    expect(usageSummary(usage)).toBe("4,200 in · 420 out · ~$0.011");
  });

  it("leaves a fork's reused delegations out of its totals", () => {
    const steps = [{ input_tokens: 500, output_tokens: 50 }];
    const usage = runUsage([
      step({
        input_tokens: 0,
        output_tokens: 0,
        tool_calls: [],
        delegations: [
          record("reused", { reused: true, pricing: PRICE, steps }),
          record("fresh", { pricing: PRICE, steps }),
        ],
      }),
      step({ input_tokens: 0, output_tokens: 0 }),
    ]);
    expect([usage.inputTokens, usage.outputTokens]).toEqual([500, 50]);
    expect(usage.agents.map((agent) => agent.id)).toEqual(["main", "fresh"]);
  });

  it("shows tokens only when no model has a price", () => {
    const usage = runUsage([step({ execution: execution({ pricing: null }) })]);
    expect(usage.cost).toBeNull();
    expect(usageSummary(usage)).toBe("1,000 in · 100 out");
  });

  it("marks a cost partial when an unpriced sub-agent ran", () => {
    const usage = runUsage([
      step({
        delegations: [
          record("child", { steps: [{ input_tokens: 10, output_tokens: 1 }] }),
        ],
      }),
    ]);
    expect(usage.partialCost).toBe(true);
    expect(usage.agents[1].cost).toBeNull();
    expect(usageSummary(usage)).toBe("1,010 in · 101 out · ~$0.0030 (partial)");
  });

  it("labels plan-backed runs instead of pricing them", () => {
    const plan = execution({ provider_type: "chatgpt", pricing: null });
    const usage = runUsage([step({ execution: plan })]);
    expect(usage.allPlan).toBe(true);
    expect(usage.cost).toBeNull();
    expect(usageSummary(usage)).toBe("1,000 in · 100 out · ChatGPT plan");

    // A plan sub-agent under a priced main agent is plan usage, not "partial".
    const mixed = runUsage([
      step({
        delegations: [
          record("child", {
            provider_type: "chatgpt",
            steps: [{ input_tokens: 10, output_tokens: 1 }],
          }),
        ],
      }),
    ]);
    expect(mixed).toMatchObject({
      allPlan: false,
      anyPlan: true,
      partialCost: false,
    });
    expect(mixed.agents[1].cost).toBeNull();
    expect(mixed.cost).toBeCloseTo(0.003, 8);
  });

  it("uses the price recorded on each step, not a current one", () => {
    const usage = runUsage([
      step({
        execution: execution({
          pricing: { input_per_million: 0, output_per_million: 0 },
        }),
      }),
    ]);
    expect(usage.cost).toBe(0);
    expect(usageSummary(usage)).toBe("1,000 in · 100 out · ~$0.00");
  });

  it("formats small and ordinary amounts", () => {
    expect(formatCost(0.004213)).toBe("$0.0042");
    expect(formatCost(0.5)).toBe("$0.50");
    expect(formatCost(1.2749)).toBe("$1.27");
  });
});

describe("turn steps", () => {
  const user = step({ role: "user" });
  const middle = step({ tool_calls: [] });
  const last = step();

  it("returns the turn's assistant steps for its settled final step", () => {
    const messages = [user, middle, last, step({ role: "user" })];
    expect(turnStepsEndingAt(messages, 2)).toEqual([middle, last]);
    expect(turnStepsEndingAt(messages, 1)).toBeNull();
    expect(turnStepsEndingAt(messages, 0)).toBeNull();
    expect(turnStepsEndingAt(messages, 3)).toBeNull();
  });
});
