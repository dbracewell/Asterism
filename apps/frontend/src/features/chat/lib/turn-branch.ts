import type { Message } from "@/lib/client";

/**
 * The step whose versions a turn's answer switches between (US-90.2).
 *
 * Regenerating re-runs from the visible answer's parent, so the new version is
 * a sibling of whatever the run's first step was. When that run calls a tool
 * first (a project chat searching its files), the versions sit on a tool-call
 * step that shows no footer. The answer's switcher therefore controls the
 * nearest step in the turn that has other versions, or the answer itself.
 */
export function turnBranchStep<T extends Message>(
  answer: T,
  steps?: Message[] | null,
): Message {
  for (const step of [...(steps ?? [])].reverse()) {
    if ((step.sibling_count ?? 1) > 1) return step;
  }
  return answer;
}
