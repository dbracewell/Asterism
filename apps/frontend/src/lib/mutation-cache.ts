import type {
  InvalidateQueryFilters,
  Mutation,
  Query,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

export interface AppMutationMeta {
  invalidates?: QueryKey[];
  skipGlobalInvalidation?: boolean;
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: AppMutationMeta;
  }
}

const firstLoad = (query: Query) =>
  query.state.data === undefined && query.state.fetchStatus === "fetching";

/**
 * Invalidate, after cancelling first loads still in flight. TanStack Query
 * refetches a query that has data, but reuses a running first load instead, so
 * a list that started loading before the mutation committed would keep its
 * stale answer (a class joined while "Your classes" was still loading).
 */
async function invalidate(
  queryClient: QueryClient,
  filters: InvalidateQueryFilters = {},
) {
  await queryClient.cancelQueries({ ...filters, predicate: firstLoad });
  await queryClient.invalidateQueries(filters);
}

export function handleMutationSuccess(
  queryClient: QueryClient,
  mutation: Mutation<unknown, unknown, unknown, unknown>,
) {
  const meta = mutation.meta as AppMutationMeta | undefined;
  if (meta?.skipGlobalInvalidation) {
    return;
  }
  if (meta?.invalidates && meta.invalidates.length > 0) {
    for (const queryKey of meta.invalidates) {
      void invalidate(queryClient, { queryKey });
    }
    return;
  }
  void invalidate(queryClient);
}
