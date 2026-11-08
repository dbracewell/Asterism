import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ContextUsageProgress } from "./context-usage";

vi.mock("@/features/help/components/help-topic", () => ({
  HelpTopic: () => null,
}));

const usage = { input_tokens: 700, total_tokens: 800, estimated: true };

it("opens from the meter and compacts on request", async () => {
  const user = userEvent.setup();
  const onCompact = vi.fn();
  render(
    <ContextUsageProgress
      usage={usage}
      contextWindow={1000}
      onCompact={onCompact}
      canCompact
    />,
  );
  await user.click(
    screen.getByRole("button", {
      name: "Context usage: about 80% of the model's context window",
    }),
  );
  expect(screen.getByText(/about 800 of 1,000 tokens \(80%\)/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Compact now" }));
  expect(onCompact).toHaveBeenCalledTimes(1);
});

it("disables Compact now while busy and shows progress", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ContextUsageProgress
      usage={usage}
      contextWindow={1000}
      onCompact={vi.fn()}
      canCompact={false}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Context usage/ }));
  expect(screen.getByRole("button", { name: "Compact now" })).toBeDisabled();
  rerender(
    <ContextUsageProgress
      usage={usage}
      contextWindow={1000}
      onCompact={vi.fn()}
      canCompact
      compacting
    />,
  );
  expect(screen.getByRole("button", { name: "Compacting…" })).toBeDisabled();
});

it("shows nothing without a known window", () => {
  const { container } = render(
    <ContextUsageProgress usage={usage} contextWindow={null} />,
  );
  expect(container).toBeEmptyDOMElement();
});
