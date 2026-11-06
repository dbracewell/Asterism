import { TargetIcon } from "lucide-react";

const DAY = 24 * 60 * 60 * 1000;

/** Whole days from `today` to an ISO date (negative when it has passed). */
export function daysUntil(date: string, today: Date = new Date()) {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const start = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round((target - start) / DAY);
}

function relative(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** The project's learning goal on its overview (US-58.1). */
export function ProjectGoal({
  goal,
  targetDate,
  today,
}: {
  goal: string;
  targetDate: string | null | undefined;
  today?: Date;
}) {
  if (!goal.trim()) return null;
  return (
    <section
      aria-label="Learning goal"
      className="border-border rounded-surface flex min-w-0 items-start gap-3 border p-4"
    >
      <TargetIcon
        className="text-muted-foreground mt-0.5 size-5 shrink-0"
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-sm font-medium">Learning goal</h2>
        <p className="wrap-anywhere whitespace-pre-wrap">{goal.trim()}</p>
        {targetDate && (
          <p className="text-muted-foreground text-sm">
            Target{" "}
            <time dateTime={targetDate}>
              {new Date(`${targetDate}T00:00:00`).toLocaleDateString(
                undefined,
                {
                  dateStyle: "medium",
                },
              )}
            </time>{" "}
            ({relative(daysUntil(targetDate, today))})
          </p>
        )}
      </div>
    </section>
  );
}
