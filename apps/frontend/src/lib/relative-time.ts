const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Validates an IANA time zone, falling back to UTC so a bad stored value never
 * breaks rendering.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Days between the calendar dates of `from` and `to` in `timeZone`. */
function calendarDayDiff(from: Date, to: Date, timeZone: string) {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = (date: Date) => Date.parse(`${format.format(date)}T00:00:00Z`);
  return Math.round((day(to) - day(from)) / (24 * HOUR));
}

/**
 * Short relative label for a past timestamp: "now", "5 minutes ago",
 * "3 hours ago", "yesterday", "4 days ago", then a calendar date. Day
 * boundaries follow the user's time zone, not the browser's.
 */
export function formatRelativeTime(
  timestamp: Date,
  now: Date,
  timeZone: string,
  locale?: string,
): string {
  const zone = resolveTimeZone(timeZone);
  const elapsed = Math.max(0, now.getTime() - timestamp.getTime());
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (elapsed < 45_000) return relative.format(0, "second");
  if (elapsed < HOUR) {
    return relative.format(
      -Math.max(1, Math.round(elapsed / MINUTE)),
      "minute",
    );
  }
  const days = calendarDayDiff(timestamp, now, zone);
  if (elapsed < 6 * HOUR || days <= 0) {
    return relative.format(-Math.round(elapsed / HOUR), "hour");
  }
  if (days < 7) return relative.format(-days, "day");

  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
  });
  const sameYear = year.format(timestamp) === year.format(now);
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(timestamp);
}

/** Full date and time with zone name, for tooltips. */
export function formatFullTimestamp(
  timestamp: Date,
  timeZone: string,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: resolveTimeZone(timeZone),
    dateStyle: "full",
    timeStyle: "long",
  }).format(timestamp);
}
