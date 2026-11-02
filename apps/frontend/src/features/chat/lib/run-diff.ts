import type { CapabilityEntry, Message, RecordedRun } from "@/lib/client";
import { turnCapabilities } from "./capability-manifest";
import { costLabel, formatTokens, runUsage } from "./run-usage";

/**
 * Run diff (US-54.6): what changed between two recorded runs. Everything is
 * read from what each run recorded (answers, delegation records, usage and
 * capability manifests); nothing is recomputed from current settings.
 */

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/** Above this many comparison cells, diff by line; above it again, give up. */
const MAX_CELLS = 400_000;

const words = (text: string) => text.match(/\s+|[^\s]+/g) ?? [];
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+/g) ?? [];

function lcsDiff(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  // lengths[i][j]: LCS of a[i..] and b[j..], in one flat array.
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      push("removed", a[i]);
      i += 1;
    } else {
      push("added", b[j]);
      j += 1;
    }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return parts;
}

/** A word-level diff of two texts; line-level for long texts. */
export function textDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  for (const split of [words, lines]) {
    const a = split(before);
    const b = split(after);
    if ((a.length + 1) * (b.length + 1) <= MAX_CELLS) return lcsDiff(a, b);
  }
  return [
    ...(before ? [{ kind: "removed" as const, text: before }] : []),
    ...(after ? [{ kind: "added" as const, text: after }] : []),
  ];
}

export type FactRow = {
  label: string;
  before: string;
  after: string;
  changed: boolean;
};

const row = (label: string, before: string, after: string): FactRow => ({
  label,
  before,
  after,
  changed: before !== after,
});

const NONE = "—";

/** The answer a run ended with: its last step's text. */
export const finalAnswer = (run: RecordedRun) =>
  run.steps.at(-1)?.content ?? "";

/** Each agent in a run, by name: the models it ran on and how many times. */
function agents(steps: Message[]): Map<string, string> {
  const runs = new Map<string, { models: Set<string>; count: number }>();
  const add = (name: string, model: string | null | undefined) => {
    const entry = runs.get(name) ?? { models: new Set<string>(), count: 0 };
    entry.count += 1;
    if (model) entry.models.add(model);
    runs.set(name, entry);
  };
  const execution = steps.find((step) => step.execution)?.execution;
  if (steps.length) add("Main agent", execution?.model.name);
  for (const step of steps)
    for (const record of step.delegations ?? [])
      add(record.name, record.model_name);
  return new Map(
    [...runs].map(([name, { models, count }]) => [
      name,
      [
        [...models].sort().join(", ") || "Unknown model",
        count > 1 && `×${count}`,
      ]
        .filter(Boolean)
        .join(" "),
    ]),
  );
}

/** Tool calls in a run by tool name, counting the main agent and every sub-agent. */
function toolCalls(steps: Message[]): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const step of steps) {
    for (const call of step.tool_calls ?? []) add(call.function.name);
    for (const record of step.delegations ?? [])
      for (const call of record.tool_calls ?? []) add(call.function.name);
  }
  return counts;
}

const union = <K>(a: Map<K, unknown>, b: Map<K, unknown>) => [
  ...new Set([...a.keys(), ...b.keys()]),
];

export function agentRows(before: RecordedRun, after: RecordedRun): FactRow[] {
  const a = agents(before.steps);
  const b = agents(after.steps);
  return union(a, b).map((name) =>
    row(name, a.get(name) ?? NONE, b.get(name) ?? NONE),
  );
}

export function toolRows(before: RecordedRun, after: RecordedRun): FactRow[] {
  const a = toolCalls(before.steps);
  const b = toolCalls(after.steps);
  return union(a, b)
    .sort()
    .map((name) =>
      row(name, String(a.get(name) ?? 0), String(b.get(name) ?? 0)),
    );
}

export function usageRows(before: RecordedRun, after: RecordedRun): FactRow[] {
  const a = runUsage(before.steps);
  const b = runUsage(after.steps);
  return [
    row(
      "Input tokens",
      formatTokens(a.inputTokens),
      formatTokens(b.inputTokens),
    ),
    row(
      "Output tokens",
      formatTokens(a.outputTokens),
      formatTokens(b.outputTokens),
    ),
    row("Cost", costLabel(a) ?? NONE, costLabel(b) ?? NONE),
  ];
}

export type CapabilityChange = {
  agent: string;
  added: string[];
  removed: string[];
  /** One side recorded no manifest for this agent. */
  missing: "before" | "after" | null;
};

const entryLabel = (entry: CapabilityEntry) =>
  `${entry.kind.replace("_", "-")}: ${entry.name ?? entry.id}`;

/** Per agent name, the capability entries one run had and the other didn't. */
export function capabilityChanges(
  before: RecordedRun,
  after: RecordedRun,
): CapabilityChange[] {
  const byName = (run: RecordedRun) => {
    const map = new Map<string, Set<string> | null>();
    for (const agent of turnCapabilities(run.steps)) {
      // An agent delegated several times keeps the union of its manifests.
      const entries = agent.manifest
        ? (agent.manifest.entries ?? []).map(entryLabel)
        : null;
      const seen = map.get(agent.name);
      if (entries === null) {
        if (!map.has(agent.name)) map.set(agent.name, null);
      } else map.set(agent.name, new Set([...(seen ?? []), ...entries]));
    }
    return map;
  };
  const a = byName(before);
  const b = byName(after);
  return union(a, b).flatMap((agent): CapabilityChange[] => {
    const left = a.get(agent);
    const right = b.get(agent);
    if (!left || !right) {
      if (!left && !right) return [];
      return [
        {
          agent,
          added: [...(right ?? [])].sort(),
          removed: [...(left ?? [])].sort(),
          missing: left ? "after" : "before",
        },
      ];
    }
    const added = [...right].filter((entry) => !left.has(entry)).sort();
    const removed = [...left].filter((entry) => !right.has(entry)).sort();
    return added.length || removed.length
      ? [{ agent, added, removed, missing: null }]
      : [];
  });
}

/**
 * Runs to diff a settled turn against: its own branch and the branches beside
 * it at the turn's first fork point (a regeneration, an edited prompt or a
 * fork). `turn` is the user turn followed by its assistant steps; the last
 * step is this branch's final answer. Null when the turn has no other branch.
 */
export function branchDiffChoices(
  turn: Message[],
): { choices: { messageId: string; label: string }[]; current: number } | null {
  const fork = turn.find((message) => (message.sibling_count ?? 0) > 1);
  const final = turn.at(-1);
  if (!fork || !final || final.role !== "assistant") return null;
  const position = fork.current_sibling_index ?? 0;
  const count = fork.sibling_count ?? 0;
  const branch = (offset: number) => `Branch ${position + offset} of ${count}`;
  const choices = [
    ...(fork.previous_sibling_id
      ? [{ messageId: fork.previous_sibling_id, label: branch(-1) }]
      : []),
    { messageId: final.id, label: `${branch(0)} (this one)` },
    ...(fork.next_sibling_id
      ? [{ messageId: fork.next_sibling_id, label: branch(1) }]
      : []),
  ];
  return { choices, current: fork.previous_sibling_id ? 1 : 0 };
}
