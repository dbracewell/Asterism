import { describe, expect, it } from "vitest";
import { addDays, daySpan, formatDay, isoDate } from "./dates";

describe("study dates", () => {
  it("formats local dates and adds days across month ends", () => {
    expect(isoDate(new Date(2026, 10, 2))).toBe("2026-11-02");
    expect(isoDate(addDays(new Date(2026, 10, 29), 3))).toBe("2026-12-02");
  });

  it("counts inclusive day spans", () => {
    expect(daySpan("2026-11-02", "2026-11-02")).toBe(1);
    expect(daySpan("2026-11-02", "2026-11-05")).toBe(4);
    expect(daySpan("2026-11-05", "2026-11-02")).toBe(-2);
    expect(daySpan("", "2026-11-02")).toBeNaN();
  });

  it("formats a calendar day without shifting it", () => {
    expect(formatDay("2026-11-02")).toContain("2");
    expect(formatDay("2026-11-02")).toMatch(/Monday|Mon/);
  });
});
