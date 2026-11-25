/** Navigation and guide links for the setup walkthrough's steps (EPIC-101). */

import { walkthroughHref } from "@/features/guide/links";
import { adminSectionWalkthrough } from "@/features/help/pages";
import { SETUP_STEPS, type SetupStep } from "./steps";

export type StepState = "done" | "skipped" | undefined;

/** The first step not done or skipped, or null when every step was reviewed. */
export function nextStep(
  states: Record<string, { state: string } | undefined>,
): SetupStep | null {
  return SETUP_STEPS.find((step) => !states[step.id]) ?? null;
}

/** The guide page that explains a step, or undefined when there is none. */
export function stepGuideHref(step: SetupStep): string | undefined {
  const walkthrough = adminSectionWalkthrough(step.id);
  return walkthrough ? walkthroughHref(walkthrough) : undefined;
}

export function setupHref(step?: string) {
  const query = new URLSearchParams({ t: "admin", setting: "setup" });
  if (step) query.set("step", step);
  return `/settings?${query}`;
}
