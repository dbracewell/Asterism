import { client } from "@/lib/api";
import { userAboutGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions } from "@tanstack/react-query";

/** Private About you text must never reuse another signed-in owner's cache. */
export function aboutQueryOptions(userId: string) {
  const options = userAboutGetOptions({ client });
  return queryOptions({
    ...options,
    queryKey: [{ ...options.queryKey[0], _id: `userAboutGet:${userId}` }],
    enabled: !!userId,
    staleTime: 0,
    retry: false,
  });
}
