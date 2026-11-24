// A stand-in for "@/features/availability/queries" in unit tests (EPIC-97).
// Every feature is on unless a test turns it off:
//
//   vi.mock("@/features/availability/queries", () => import("@/test/availability"));
//   import { turnOff } from "@/test/availability";
//   beforeEach(() => turnOff());          // everything on
//   turnOff("delegation");                // this feature off
import type { Feature } from "@/features/availability/queries";

const off = new Set<string>();

/** Turn the named features off, and every other feature on. */
export function turnOff(...features: Feature[]) {
  off.clear();
  for (const feature of features) off.add(feature);
}

const answer = (feature: string) =>
  off.has(feature)
    ? { available: false, reason: "Turned off by your administrator" }
    : { available: true, reason: "" };

export const useFeature = (feature: Feature) => answer(feature);
export const useOwnerFeature = (_owner: string, feature: Feature) =>
  answer(feature);
export const availabilityQueryKey = () => [{ _id: "availabilityGet" }];
export const availabilityOptions = (owner: string) => ({
  queryKey: [{ _id: "availabilityGet", owner }],
  queryFn: async () => null,
});
