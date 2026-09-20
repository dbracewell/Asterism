import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { useConfirmationDialog } from "./confirmation-dialog";

const Harness = ({ onResult }: { onResult: (result: boolean) => void }) => {
  const { confirm, Dialog } = useConfirmationDialog({
    title: "Delete chats?",
    description: "Permanent action.",
    confirmVariant: "destructive",
  });
  return (
    <>
      <button onClick={async () => onResult(await confirm())}>Open</button>
      <Dialog />
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
