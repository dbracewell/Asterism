import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ContextUsageMeter } from "./chat-session";

it.each([
  [50, "normal"],
  [75, "warning"],
  [95, "critical"],
])("renders the %s%% context meter state", (percent) => {
  render(
    <ContextUsageMeter
      contextWindow={100}
      usage={{
        input_tokens: percent,
        total_tokens: percent,
        reserved_output_tokens: 0,
        estimated: true,
      }}
    />,
  );

  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    String(percent),
  );
});

it("still shows the token estimate when the context limit is unknown", () => {
  render(
    <ContextUsageMeter
      contextWindow={null}
      usage={{ input_tokens: 10, total_tokens: 10, estimated: true }}
    />,
  );

  expect(
    screen.getByText("Estimated input: 10 tokens · Context window unknown"),
  ).toBeInTheDocument();
});
