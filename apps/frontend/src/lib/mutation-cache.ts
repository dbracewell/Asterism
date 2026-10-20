import type { Mutation, QueryClient, QueryKey } from "@tanstack/react-query";

export interface AppMutationMeta {
  invalidates?: QueryKey[];
  skipGlobalInvalidation?: boolean;
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: AppMutationMeta;
  }
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
      void queryClient.invalidateQueries({ queryKey });
    }
    return;
  }
  void queryClient.invalidateQueries();
}
