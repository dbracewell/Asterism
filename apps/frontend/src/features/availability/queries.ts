import { queryOptions, useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/components/user-context";
import { client } from "@/lib/api";
import {
  availabilityGetOptions,
  availabilityGetQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import type { Availability, FeatureAvailability } from "@/lib/client";

export type Feature = keyof Availability;

/** Refetch soon after another tab's admin changes a policy (EPIC-96). */
const AVAILABILITY_STALE_MS = 30_000;

/**
 * The admin's live switches for the signed-in person. Admin policy saves
 * invalidate this key, so a change shows up without a reload.
 */
export function availabilityOptions(owner: string) {
  const options = availabilityGetOptions({ client });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: AVAILABILITY_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

/** Matches every owner's availability query, for mutation `invalidates`. */
export const availabilityQueryKey = () => availabilityGetQueryKey({ client });

const UNKNOWN: FeatureAvailability = { available: false, reason: "" };

/**
 * One feature's availability. While it loads, or if it fails, the feature
 * reads as unavailable: hiding it never grants or removes anything, because
 * the server checks again when the feature is used.
 */
export function useFeature(feature: Feature): FeatureAvailability {
  const user = useUser();
  const { data } = useQuery(availabilityOptions(user.id));
  return data?.[feature] ?? UNKNOWN;
}
