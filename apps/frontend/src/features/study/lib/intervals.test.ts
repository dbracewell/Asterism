import { expect, it } from "vitest";
import { describeInterval, formatInterval } from "./intervals";

it.each([
  [0, "1m", "in 1 minute"],
  [60, "1m", "in 1 minute"],
  [330, "6m", "in 6 minutes"],
  [600, "10m", "in 10 minutes"],
  [3 * 3600, "3h", "in 3 hours"],
  [2 * 86400, "2d", "in 2 days"],
  [8 * 86400, "8d", "in 8 days"],
  [83 * 86400, "3mo", "in 3 months"],
  [548 * 86400, "1.5y", "in 2 years"],
  [-50, "1m", "in 1 minute"],
])("formats %i seconds", (seconds, short, spoken) => {
  expect(formatInterval(seconds)).toBe(short);
  expect(describeInterval(seconds)).toBe(spoken);
});
