import { client } from "@/lib/api";
import type { ChatInfo } from "@/lib/client";
import {
  projectGetOneOptions,
  reflectionGetManyOptions,
  reflectionGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions, useQuery } from "@tanstack/react-query";

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

/**
 * Whether reflections are offered for a chat (US-111.1): always in General,
 * and in a project only while its Reflections area is on, so a reflection is
 * never saved to a tab the learner can't see. Unknown (loading) is no.
 */
export function useReflectionsShown(chat: ChatInfo): boolean {
  const projectId = chat.project_id ?? null;
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId ?? "" } }),
    enabled: projectId !== null,
    retry: false,
  });
  if (chat.purpose === "skill_draft") return false;
  if (projectId === null) return true;
  return project.data?.areas?.reflections === true;
}

/** Where a chat's reflections are listed. */
export function reflectionsHref(projectId: string | null): string {
  return projectId ? `/projects/${projectId}?tab=reflections` : "/general";
}
