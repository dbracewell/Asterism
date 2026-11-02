import type {
  CapabilityEntry,
  CapabilityGrant,
  CapabilityKind,
  CapabilityManifest,
  Message,
} from "@/lib/client";
import { formatPlural } from "@/lib/formatters";

/**
 * Capability manifests (US-54.2): what each agent in a turn could use, and
 * the grants that allowed it. Everything shown comes from the manifest
 * recorded when that agent started; nothing is recomputed from current
 * settings, so the view stays true about past runs.
 */

export type AgentCapabilities = {
  /** "main", or the delegation's execution id. */
  id: string;
  name: string;
  isSubAgent: boolean;
  model: string | null;
  depth: number;
  /** Null when the run recorded no manifest (for example, it failed to start). */
  manifest: CapabilityManifest | null;
};

export const grantLabel: Record<CapabilityGrant, string> = {
  agent_assignment: "Assigned to the agent",
  admin_policy: "Enabled by the admin",
  model_support: "Model supports tools",
  project_selection: "Selected in the project",
  chat_attachment: "Attached in this chat",
  chat_selection: "Active in this chat",
  file_scope: "Files in scope",
};

export const capabilityGroups: { kind: CapabilityKind; title: string }[] = [
  { kind: "tool", title: "Tools" },
  { kind: "skill", title: "Skills" },
  { kind: "sub_agent", title: "Sub-agents" },
  { kind: "file", title: "Files" },
];

const kindNoun: Record<CapabilityKind, string> = {
  tool: "tool",
  skill: "skill",
  sub_agent: "sub-agent",
  file: "file",
};

export const entriesOfKind = (
  manifest: CapabilityManifest,
  kind: CapabilityKind,
): CapabilityEntry[] =>
  (manifest.entries ?? []).filter((entry) => entry.kind === kind);

/** "3 tools · 1 skill · 2 files", or "Nothing" for an agent with no entries. */
export function manifestSummary(manifest: CapabilityManifest): string {
  const parts = capabilityGroups
    .map(({ kind }) => [kind, entriesOfKind(manifest, kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => formatPlural(count, kindNoun[kind]));
  return parts.length ? parts.join(" · ") : "Nothing";
}

/**
 * Every agent in one turn: the main agent from the turn's recorded execution,
 * then each sub-agent from its delegation record. Returns an empty list when
 * nothing in the turn recorded a manifest.
 */
export function turnCapabilities(steps: Message[]): AgentCapabilities[] {
  const assistant = steps.filter((step) => step.role === "assistant");
  const execution = assistant.find((step) => step.execution)?.execution;
  const agents: AgentCapabilities[] = [
    {
      id: "main",
      name: "Main agent",
      isSubAgent: false,
      model: execution?.model.name ?? null,
      depth: 0,
      manifest: execution?.capabilities ?? null,
    },
    ...assistant.flatMap((step) =>
      (step.delegations ?? []).map((record) => ({
        id: record.execution_id,
        name: record.name,
        isSubAgent: true,
        model: record.model_name ?? null,
        depth: record.depth,
        manifest: record.capabilities ?? null,
      })),
    ),
  ];
  return agents.some((agent) => agent.manifest) ? agents : [];
}
