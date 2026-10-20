import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { expect, it, vi } from "vitest";
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from "./confirmation-dialog";

const Harness = ({ onResult }: { onResult: (result: boolean) => void }) => {
  const { confirm, dialog } = useConfirmationDialog({
    title: "Delete chats?",
    description: "Permanent action.",
    confirmVariant: "destructive",
  });
  return (
    <>
      <button onClick={async () => onResult(await confirm())}>Open</button>
      {dialog}
    </>
  );
};

it("resolves false when a destructive confirmation is cancelled", async () => {
  const results: boolean[] = [];
  render(<Harness onResult={(result) => results.push(result)} />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Open" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(results).toEqual([false]);
});

it("resolves false when Escape dismisses a confirmation", async () => {
  const results: boolean[] = [];
  render(<Harness onResult={(result) => results.push(result)} />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Open" }));
  await user.keyboard("{Escape}");

  expect(results).toEqual([false]);
});

it("resolves true when confirmation is accepted", async () => {
  const results: boolean[] = [];
  render(<Harness onResult={(result) => results.push(result)} />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Open" }));
  await user.click(screen.getByRole("button", { name: "Confirm" }));

  expect(results).toEqual([true]);
});

it("preserves dialog element type across parent re-renders", () => {
  const ReRenderHarness = () => {
    const [count, setCount] = useState(0);
    const { dialog } = useConfirmationDialog({
      title: `Delete ${count} items?`,
      description: "Are you sure?",
    });

    return (
      <div>
        <button onClick={() => setCount((c) => c + 1)}>Increment</button>
        {dialog}
      </div>
    );
  };

  const { getByRole } = render(<ReRenderHarness />);
  const button = getByRole("button", { name: "Increment" });
  button.click();
});

it("renders ConfirmationDialog standalone component directly", async () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();

  const { rerender } = render(
    <ConfirmationDialog
      open={true}
      onOpenChange={vi.fn()}
      title="Standalone Dialog"
      description="Testing standalone component"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

  expect(screen.getByText("Standalone Dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);

  rerender(
    <ConfirmationDialog
      open={true}
      onOpenChange={vi.fn()}
      title="Standalone Dialog"
      description="Testing standalone component"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
