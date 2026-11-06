import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProjectGoal, daysUntil } from "./project-goal";

const today = new Date(2026, 10, 6);

it("counts whole calendar days to the target", () => {
  expect(daysUntil("2026-11-06", today)).toBe(0);
  expect(daysUntil("2026-11-20", today)).toBe(14);
  expect(daysUntil("2026-11-01", today)).toBe(-5);
});

it("shows the goal with its target date, and nothing without a goal", () => {
  const { rerender, container } = render(
    <ProjectGoal
      goal="  Write a lab report  "
      targetDate="2026-11-07"
      today={today}
    />,
  );
  const region = screen.getByRole("region", { name: "Learning goal" });
  expect(region).toHaveTextContent("Write a lab report");
  expect(region).toHaveTextContent("(tomorrow)");
  expect(region.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-11-07",
  );
  rerender(<ProjectGoal goal="Pass" targetDate={null} today={today} />);
  expect(screen.getByRole("region")).not.toHaveTextContent("Target");
  rerender(<ProjectGoal goal="  " targetDate="2026-11-07" today={today} />);
  expect(container).toBeEmptyDOMElement();
});
