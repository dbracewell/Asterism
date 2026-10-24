import { client } from "@/lib/api";
import { userPersonaListOptions } from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions } from "@tanstack/react-query";

/** Private USER.md data must never reuse another authenticated owner's cache. */
export function personaQueryOptions(userId: string) {
  const options = userPersonaListOptions({ client });
  return queryOptions({
    ...options,
    queryKey: [{ ...options.queryKey[0], _id: `userPersonaList:${userId}` }],
    enabled: !!userId,
    staleTime: 0,
    retry: false,
  });
}
