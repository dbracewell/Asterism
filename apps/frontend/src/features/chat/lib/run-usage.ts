import type { DelegationRecord, Message, ModelPricing } from "@/lib/client";

/**
 * Run usage (US-54.1): token totals and an estimated cost for one turn, broken
 * down per agent and per model call. Everything comes from what was recorded
 * when the run executed — each step's provider-reported tokens and the price
 * snapshot taken with its model — never from current model settings.
 */

export type UsageStepRow = {
  inputTokens: number;
  outputTokens: number;
  /** US dollars; null when the step's model had no price or ran on a plan. */
  cost: number | null;
};

export type AgentUsage = {
  /** Main agent, or a delegation's execution id. */
  id: string;
  name: string;
  model: string | null;
  depth: number;
  plan: boolean;
  priced: boolean;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  steps: UsageStepRow[];
};

export type RunUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Sum over priced steps; null when no step was priced. */
  cost: number | null;
  /** Some non-plan steps had no price, so `cost` covers only part of the run. */
  partialCost: boolean;
  /** Every step ran on a ChatGPT plan, which is plan usage rather than dollars. */
  allPlan: boolean;
  anyPlan: boolean;
  agents: AgentUsage[];
};

const PLAN_PROVIDER = "chatgpt";

export function stepCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing | null | undefined,
  plan: boolean,
): number | null {
  if (plan || !pricing) return null;
  return (
    (inputTokens * pricing.input_per_million +
      outputTokens * pricing.output_per_million) /
    1_000_000
  );
}

function agentUsage(
  base: Omit<
    AgentUsage,
    "inputTokens" | "outputTokens" | "cost" | "steps" | "priced"
  >,
  pricing: ModelPricing | null | undefined,
  steps: { input_tokens?: number; output_tokens?: number }[],
): AgentUsage {
  const rows = steps.map((step) => {
    const inputTokens = step.input_tokens ?? 0;
    const outputTokens = step.output_tokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      cost: stepCost(inputTokens, outputTokens, pricing, base.plan),
    };
  });
  const priced = !base.plan && !!pricing;
  return {
    ...base,
    priced,
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    cost: priced ? rows.reduce((sum, row) => sum + (row.cost ?? 0), 0) : null,
    steps: rows,
  };
}

function delegationUsage(record: DelegationRecord): AgentUsage {
  return agentUsage(
    {
      id: record.execution_id,
      name: record.name,
      model: record.model_name ?? null,
      depth: record.depth,
      plan: record.provider_type === PLAN_PROVIDER,
    },
    record.pricing,
    record.steps ?? [],
  );
}

/**
 * Summarizes the assistant steps of one turn (one message per main-agent model
 * call, each carrying the delegations its tool calls ran).
 */
export function runUsage(steps: Message[]): RunUsage {
  const assistant = steps.filter((step) => step.role === "assistant");
  const model = assistant.find((step) => step.execution)?.execution?.model;
  const main = agentUsage(
    {
      id: "main",
      name: "Main agent",
      model: model?.name ?? null,
      depth: 0,
      plan: model?.provider_type === PLAN_PROVIDER,
    },
    model?.pricing,
    assistant,
  );
  const agents = [
    main,
    ...assistant.flatMap((step) =>
      (step.delegations ?? []).map(delegationUsage),
    ),
  ];
  const counted = agents.filter((agent) => agent.steps.length > 0);
  const priced = counted.filter((agent) => agent.priced);
  return {
    inputTokens: agents.reduce((sum, agent) => sum + agent.inputTokens, 0),
    outputTokens: agents.reduce((sum, agent) => sum + agent.outputTokens, 0),
    cost: priced.length
      ? priced.reduce((sum, agent) => sum + (agent.cost ?? 0), 0)
      : null,
    partialCost:
      priced.length > 0 &&
      counted.some((agent) => !agent.priced && !agent.plan),
    allPlan: counted.length > 0 && counted.every((agent) => agent.plan),
    anyPlan: counted.some((agent) => agent.plan),
    agents,
  };
}

const tokenCount = new Intl.NumberFormat();

export const formatTokens = (count: number) => tokenCount.format(count);

/** Two significant digits under a dollar ("$0.0042", "$0.50"), cents above. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 1) return `$${usd.toPrecision(2)}`;
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** The cost part of a summary line, or null when only tokens can be shown. */
export function costLabel(usage: {
  cost: number | null;
  plan?: boolean;
  allPlan?: boolean;
  partialCost?: boolean;
}): string | null {
  if (usage.allPlan || usage.plan) return "ChatGPT plan";
  if (usage.cost == null) return null;
  return `~${formatCost(usage.cost)}${usage.partialCost ? " (partial)" : ""}`;
}

/** "1,234 in · 56 out · ~$0.0042" */
export function usageSummary(usage: RunUsage): string {
  const cost = costLabel(usage);
  return [
    `${formatTokens(usage.inputTokens)} in`,
    `${formatTokens(usage.outputTokens)} out`,
    ...(cost ? [cost] : []),
  ].join(" · ");
}

/**
 * The assistant steps of the turn that ends at `index`, or null unless that
 * message is a settled final step (no further tool calls).
 */
export function turnStepsEndingAt<T extends Message>(
  messages: T[],
  index: number,
): T[] | null {
  const last = messages[index];
  if (!last || last.role !== "assistant" || last.tool_calls != null) {
    return null;
  }
  let start = index;
  while (start > 0 && messages[start - 1].role === "assistant") start -= 1;
  return messages.slice(start, index + 1);
}
