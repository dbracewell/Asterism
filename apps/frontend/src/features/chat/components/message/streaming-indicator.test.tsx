import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreamingIndicator } from "./streaming-indicator";

describe("StreamingIndicator", () => {
  it("announces work and twinkles each star in sequence", () => {
    const { container } = render(<StreamingIndicator />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Assistant is working…",
    );
    const stars = container.querySelectorAll("circle");
    expect(stars).toHaveLength(5);
    stars.forEach((star, index) => {
      expect(star).toHaveClass("animate-twinkle", "motion-reduce:animate-none");
      expect(star.style.getPropertyValue("--node")).toBe(String(index));
    });
    expect(container.querySelector("svg")?.parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("sits in the marker column when it stands in for a reply", () => {
    render(<StreamingIndicator variant="turn" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-variant", "turn");
    expect(status.querySelector(".size-7")).not.toBeNull();
  });
});
