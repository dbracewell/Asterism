import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { CompactionDivider } from "./compaction-divider";

const compaction = {
  id: "c1",
  through_message_id: "m4",
  replaced_messages: 4,
  summary: "Goals: plan a trip.\n<b>not markup</b>",
  model_name: "Chat A",
  trigger: "automatic" as const,
  created_at: 1,
};

it("marks the compaction point and expands to the summary as plain text", async () => {
  const user = userEvent.setup();
  const { container } = render(<CompactionDivider compaction={compaction} />);
  const toggle = screen.getByRole("button", {
    name: /Conversation compacted: 4 earlier messages summarized/,
  });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(/Goals: plan a trip/)).not.toBeInTheDocument();

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const summary = container.querySelector('[data-slot="compaction-summary"]');
  expect(summary).toHaveTextContent("Goals: plan a trip. <b>not markup</b>");
  // Untrusted model output is never rendered as HTML.
  expect(summary?.querySelector("b")).toBeNull();
  expect(screen.getByText(/Written by Chat A automatically/)).toBeVisible();
});

it("names a requested compaction and a single message", () => {
  render(
    <CompactionDivider
      compaction={{ ...compaction, replaced_messages: 1, trigger: "manual" }}
    />,
  );
  expect(
    screen.getByRole("button", { name: /1 earlier message summarized/ }),
  ).toBeInTheDocument();
});
