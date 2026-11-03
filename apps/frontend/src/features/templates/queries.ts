import { client } from "@/lib/api";
import {
  promptCoachStatusGetOptions,
  promptFrameworkGetManyOptions,
  promptTemplateGetManyOptions,
  promptTemplateGetManyQueryKey,
  promptTemplateGetOneOptions,
  rubricBundledGetManyOptions,
  rubricGetManyOptions,
  rubricGetManyQueryKey,
  rubricGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions } from "@tanstack/react-query";

/** The bundled catalog is the same for every caller and changes only on deploy. */
export function frameworkCatalogOptions() {
  return queryOptions({
    ...promptFrameworkGetManyOptions({ client }),
    staleTime: Infinity,
  });
}

// Keep generated query-key prefixes for shared mutation invalidation while
// ensuring private templates are never reused for another authenticated owner.
export function templateListOptions(owner: string) {
  const options = promptTemplateGetManyOptions({
    client,
    query: { page: 1, page_size: 100 },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

/** One searchable page of the owner's templates for the settings library. */
export function templateLibraryOptions(
  owner: string,
  query: string,
  page: number,
) {
  const options = promptTemplateGetManyOptions({
    client,
    query: { query, page, page_size: LIBRARY_PAGE_SIZE },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

export const LIBRARY_PAGE_SIZE = 10;

/** Every owned-template list (library pages and the composer picker). */
export const templateMutationInvalidates = () => [
  promptTemplateGetManyQueryKey(),
];

export function templateDetailOptions(owner: string, id: string | null) {
  const options = promptTemplateGetOneOptions({
    client,
    path: { template_id: id ?? "none" },
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

/** Whether the owner's prompt coach can run now (opt-in and a usable model). */
export function coachStatusOptions(owner: string) {
  const options = promptCoachStatusGetOptions({ client });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 60 * 1000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Rubrics (US-57.1): the "rubric" kind of the template domain.
// ---------------------------------------------------------------------------

/** Bundled rubrics are the same for every caller and change only on deploy. */
export function bundledRubricsOptions() {
  return queryOptions({
    ...rubricBundledGetManyOptions({ client }),
    staleTime: Infinity,
  });
}

/** Up to 100 of the owner's rubrics, for the composer's rubric picker. */
export function rubricListOptions(owner: string) {
  const options = rubricGetManyOptions({
    client,
    query: { page: 1, page_size: 100 },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

/** One searchable page of the owner's rubrics for the settings library. */
export function rubricLibraryOptions(
  owner: string,
  query: string,
  page: number,
) {
  const options = rubricGetManyOptions({
    client,
    query: { query, page, page_size: LIBRARY_PAGE_SIZE },
  });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}

/** Every owned-rubric list (library pages and the composer picker). */
export const rubricMutationInvalidates = () => [rubricGetManyQueryKey()];

export function rubricDetailOptions(owner: string, id: string | null) {
  const options = rubricGetOneOptions({
    client,
    path: { rubric_id: id ?? "none" },
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
