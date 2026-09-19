import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SubAgentToolWarning } from "./sub-agent-tool-warning";

it("warns that delegated tools run autonomously", () => {
  render(<SubAgentToolWarning />);

  expect(screen.getByRole("note")).toHaveTextContent(
    "Sub-agent tools run autonomously without asking for permission",
  );
  expect(screen.getByRole("note")).toHaveTextContent(
    "Only select tools you trust",
  );
});
