import type { SubAgentActivity } from "@/features/chat/types";
import React from "react";

const spoken: Record<SubAgentActivity["status"], string> = {
  running: "started",
  completed: "finished",
  error: "failed",
  cancelled: "cancelled",
};

/** Status changes since the previous snapshot, as one sentence per agent. */
export function delegationChanges(
  previous: ReadonlyMap<string, SubAgentActivity["status"]>,
  activities: SubAgentActivity[],
): string[] {
  return activities
    .filter(
      (activity) => previous.get(activity.executionId) !== activity.status,
    )
    .map((activity) => `${activity.name} ${spoken[activity.status]}`);
}

/**
 * Text for a polite live region: which agents started, finished, failed or
 * were cancelled since the last update. A cleared list (a new turn) resets
 * the baseline without speaking.
 */
export function useDelegationAnnouncements(activities: SubAgentActivity[]) {
  const seen = React.useRef(new Map<string, SubAgentActivity["status"]>());
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    if (activities.length === 0) {
      seen.current = new Map();
      return;
    }
    const changes = delegationChanges(seen.current, activities);
    seen.current = new Map(
      activities.map((activity) => [activity.executionId, activity.status]),
    );
    if (changes.length) setMessage(`${changes.join(". ")}.`);
  }, [activities]);

  return message;
}
