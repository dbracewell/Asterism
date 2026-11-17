import { client } from "@/lib/api";
import {
  reflectionGetManyOptions,
  reflectionGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions } from "@tanstack/react-query";

export const REFLECTION_PAGE_SIZE = 10;

/** One page of the owner's reflections in a project (or General). */
export function reflectionListOptions(
  owner: string,
  scope: { projectId: string | null; page: number },
) {
  const options = reflectionGetManyOptions({
    client,
    query: {
      ...(scope.projectId ? { project_id: scope.projectId } : {}),
      page: scope.page,
      page_size: REFLECTION_PAGE_SIZE,
    },
  });
  // Private records must never reuse another owner's cache.
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

/** Every reflection list, refreshed after a save, edit or delete. */
export const reflectionMutationInvalidates = () => [
  reflectionGetManyQueryKey(),
];
