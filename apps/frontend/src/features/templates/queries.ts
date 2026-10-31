import { client } from "@/lib/api";
import {
  promptFrameworkGetManyOptions,
  promptTemplateGetManyOptions,
  promptTemplateGetOneOptions,
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
