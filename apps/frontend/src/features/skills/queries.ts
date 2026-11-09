import { client } from "@/lib/api";
import {
  skillGetManyOptions,
  skillGetOneOptions,
  skillDraftGetOneOptions,
  skillEligibleGetManyOptions,
  mainAgentSkillsGetOptions,
  subAgentSkillsGetOptions,
  skillGetManyQueryKey,
  mainAgentSkillsGetQueryKey,
  mainAgentGetQueryKey,
  skillEligibleGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions } from "@tanstack/react-query";

// Keep generated query-key prefixes for shared mutation invalidation while
// ensuring private data is never reused for another authenticated owner.
export function skillsListOptions(
  owner: string,
  query: string,
  page: number,
  pageSize = 10,
) {
  const options = skillGetManyOptions({
    client,
    query: { query, page, page_size: pageSize },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

export function skillDetailOptions(owner: string, id: string | null) {
  const options = skillGetOneOptions({
    client,
    path: { skill_id: id ?? "new" },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    enabled: id !== null,
    staleTime: 0,
    retry: false,
  });
}

export function skillAssignmentsOptions(owner: string) {
  const options = mainAgentSkillsGetOptions({ client });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

/** The skills one sub-agent may load with load_skill (ADR-0062). */
export function subAgentSkillsOptions(owner: string, agentId: string | null) {
  const options = subAgentSkillsGetOptions({
    client,
    path: { agent_id: agentId ?? "none" },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    enabled: agentId !== null,
    staleTime: 0,
    retry: false,
  });
}

export function skillAvailabilityOptions(owner: string) {
  const options = skillEligibleGetManyOptions({
    client,
    query: { page: 1, page_size: 1 },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

export const skillMutationInvalidates = () => [
  skillGetManyQueryKey(),
  mainAgentSkillsGetQueryKey(),
  mainAgentGetQueryKey(),
  skillEligibleGetManyQueryKey(),
];

export function eligibleSkillOptions(owner: string, query = "", page = 1) {
  const options = skillEligibleGetManyOptions({
    client,
    query: { query, page, page_size: 100 },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

/**
 * The draft in a drafting chat's latest reply (ADR-0061). `turn` changes when
 * a run ends, so each finished run reads the draft afresh.
 */
export function skillDraftOptions(
  owner: string,
  chatId: string | null,
  turn: number,
) {
  const options = skillDraftGetOneOptions({
    client,
    path: { chat_id: chatId ?? "none" },
  });
  const ownerKey = { ...options.queryKey[0], owner, turn };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    enabled: chatId !== null,
    staleTime: 0,
    retry: false,
  });
}
