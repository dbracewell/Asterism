import { client } from "@/lib/api";
import {
  skillGetManyOptions,
  skillGetOneOptions,
  skillEligibleGetManyOptions,
  mainAgentSkillsGetOptions,
  skillGetManyQueryKey,
  mainAgentSkillsGetQueryKey,
  mainAgentGetQueryKey,
  skillEligibleGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions } from "@tanstack/react-query";

// Keep generated query-key prefixes for shared mutation invalidation while
// ensuring private data is never reused for another authenticated owner.
export function skillsListOptions(owner: string, query: string, page: number) {
  const options = skillGetManyOptions({
    client,
    query: { query, page, page_size: 10 },
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
