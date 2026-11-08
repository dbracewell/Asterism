import type { GeneralSubAgents } from "@/lib/client";

/**
 * Whether the main agent can delegate in a General chat (ADR-0059), for
 * display only. The server re-derives availability on every turn; this mirrors
 * its checks: a chosen sub-agent with an available fixed model, admin policy,
 * and a chat model that explicitly supports tools.
 */
export type GeneralDelegationState =
  | { kind: "none" }
  | { kind: "available"; names: string[] }
  | { kind: "blocked"; reason: string };

export function generalDelegationState(
  set: GeneralSubAgents | undefined,
  chatModel: { supports_tools?: boolean | null } | undefined,
): GeneralDelegationState {
  if (!set?.agents.length) return { kind: "none" };
  if (!set.delegation_allowed)
    return {
      kind: "blocked",
      reason: "An administrator has turned sub-agents off.",
    };
  if (chatModel?.supports_tools !== true)
    return {
      kind: "blocked",
      reason: "This chat's model doesn't support tools, so it can't delegate.",
    };
  const names = set.agents
    .filter((agent) => agent.model_available)
    .map((agent) => agent.name);
  if (!names.length)
    return {
      kind: "blocked",
      reason: "None of your General chat sub-agents has an available model.",
    };
  return { kind: "available", names };
}
