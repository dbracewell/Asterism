import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { HeroMark } from "./new-chat-hero";

afterEach(() => sessionStorage.clear());

it("draws the constellation in once per session, then rests static", () => {
  const first = render(<HeroMark />);
  const lines = first.container.querySelectorAll("line");
  expect(lines[0]).toHaveClass("animate-line-in");
  expect(first.container.querySelector("circle")).toHaveClass(
    "animate-star-in",
  );

  // Earlier pieces finishing do not end the drawing.
  fireEvent.animationEnd(lines[0]);
  expect(sessionStorage.getItem("asterism:hero-drawn")).toBeNull();
  fireEvent.animationEnd(lines[lines.length - 1]);
  expect(sessionStorage.getItem("asterism:hero-drawn")).toBe("1");
  first.unmount();

  const second = render(<HeroMark />);
  expect(second.container.querySelector("line")).not.toHaveAttribute("class");
  expect(second.container.querySelector("circle")).not.toHaveAttribute("class");
});
