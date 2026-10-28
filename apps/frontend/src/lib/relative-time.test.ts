import { describe, expect, it } from "vitest";
import {
  formatFullTimestamp,
  formatRelativeTime,
  resolveTimeZone,
} from "./relative-time";

const now = new Date("2026-10-27T15:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const relative = (date: Date, timeZone = "UTC") =>
  formatRelativeTime(date, now, timeZone, "en-US");

describe("formatRelativeTime", () => {
  it("labels the last 45 seconds as now", () => {
    expect(relative(ago(0))).toBe("now");
    expect(relative(ago(44_000))).toBe("now");
  });

  it("treats future timestamps from clock skew as now", () => {
    expect(relative(ago(-minutes(3)))).toBe("now");
  });

  it("counts minutes, then hours", () => {
    expect(relative(ago(50_000))).toBe("1 minute ago");
    expect(relative(ago(minutes(5)))).toBe("5 minutes ago");
    expect(relative(ago(minutes(59)))).toBe("59 minutes ago");
    expect(relative(ago(hours(3)))).toBe("3 hours ago");
  });

  it("switches to days at the user's midnight, not the browser's", () => {
    const sevenHours = ago(hours(7)); // 08:00 UTC, same day in UTC
    expect(relative(sevenHours, "UTC")).toBe("7 hours ago");
    // In Auckland (UTC+13) it is 04:00 on Oct 28; 08:00 UTC was 21:00 Oct 27.
    expect(relative(sevenHours, "Pacific/Auckland")).toBe("yesterday");
  });

  it("keeps hours for a recent message across midnight", () => {
    // 15:00 UTC is 00:00 in Tokyo; two hours earlier was the previous day.
    expect(relative(ago(hours(2)), "Asia/Tokyo")).toBe("2 hours ago");
  });

  it("uses days within a week, then a date in the user's zone", () => {
    expect(relative(ago(hours(24 * 3)))).toBe("3 days ago");
    expect(relative(new Date("2026-10-12T23:30:00Z"), "UTC")).toBe("Oct 12");
    expect(relative(new Date("2026-10-12T23:30:00Z"), "Asia/Tokyo")).toBe(
      "Oct 13",
    );
    expect(relative(new Date("2025-03-02T12:00:00Z"))).toBe("Mar 2, 2025");
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(relative(ago(hours(3)), "Not/AZone")).toBe("3 hours ago");
  });
});

describe("formatFullTimestamp", () => {
  it("formats in the user's zone with its name", () => {
    expect(formatFullTimestamp(now, "UTC", "en-US")).toBe(
      "Tuesday, October 27, 2026 at 3:00:00 PM UTC",
    );
    expect(formatFullTimestamp(now, "Asia/Tokyo", "en-US")).toBe(
      "Wednesday, October 28, 2026 at 12:00:00 AM GMT+9",
    );
  });
});
