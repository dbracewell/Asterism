import { handleMutationSuccess } from "@/lib/mutation-cache";
import { MutationCache, QueryClient } from "@tanstack/react-query";

/** A test QueryClient with the app's global mutation invalidation (providers.tsx). */
export function appQueryClient() {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) =>
        handleMutationSuccess(client, mutation),
    }),
  });
  return client;
}

/** Seeds an unrelated query; a global invalidation would mark it stale. */
export function seedUnrelatedQuery(client: QueryClient) {
  const queryKey = ["unrelated"];
  client.setQueryData(queryKey, { ok: true });
  return () => client.getQueryState(queryKey)?.isInvalidated;
}
