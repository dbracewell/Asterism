import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSetupDraft } from "./setup-draft";

function Pane() {
  useSetupDraft({ dirty: true, save: vi.fn() });
  return <p>pane</p>;
}

it("does nothing outside the setup walkthrough", () => {
  render(<Pane />);
  expect(screen.getByText("pane")).toBeVisible();
});
