const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A short, approximate label for a wait such as "1m", "5h", "3d", "2mo" or "1.5y". */
export function formatInterval(seconds: number) {
  const value = Math.max(0, seconds);
  if (value < HOUR) return `${Math.max(1, Math.round(value / MINUTE))}m`;
  if (value < DAY) return `${Math.round(value / HOUR)}h`;
  if (value < 30 * DAY) return `${Math.round(value / DAY)}d`;
  if (value < 365 * DAY) return `${Math.round(value / (30 * DAY))}mo`;
  const years = value / (365 * DAY);
  return `${years < 10 ? Math.round(years * 10) / 10 : Math.round(years)}y`;
}

/** The same wait in words for screen readers, such as "in 10 minutes". */
export function describeInterval(seconds: number) {
  const value = Math.max(0, seconds);
  const unit = (count: number, word: string) =>
    `in ${count} ${word}${count === 1 ? "" : "s"}`;
  if (value < HOUR)
    return unit(Math.max(1, Math.round(value / MINUTE)), "minute");
  if (value < DAY) return unit(Math.round(value / HOUR), "hour");
  if (value < 30 * DAY) return unit(Math.round(value / DAY), "day");
  if (value < 365 * DAY) return unit(Math.round(value / (30 * DAY)), "month");
  return unit(Math.round(value / (365 * DAY)), "year");
}
