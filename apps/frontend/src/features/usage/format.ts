/** Display helpers for usage and budgets (US-86.3). */

const tokenFormat = new Intl.NumberFormat("en-US");

export function formatTokens(tokens: number): string {
  return `${tokenFormat.format(tokens)} ${tokens === 1 ? "token" : "tokens"}`;
}

/** Estimated US dollars; small non-zero amounts read as "< $0.01". */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd > 0 && usd < 0.01) return "< $0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(usd);
}

/** A reset moment (Unix seconds) in the instance usage timezone, named. */
export function formatResetTime(seconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(seconds * 1000));
}

/** A day in the usage timezone as `YYYY-MM-DD`, for date inputs and report periods. */
export function dayInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Percent of a budget used, 0–100; null when there is no budget. */
export function budgetPercent(
  used: number,
  budget: number | null | undefined,
): number | null {
  if (budget == null || budget <= 0) return null;
  return Math.min(100, Math.round((used / budget) * 100));
}
