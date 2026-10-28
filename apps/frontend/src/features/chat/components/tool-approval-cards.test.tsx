import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PermissionRequest } from "../types";
import { ToolApprovalCards } from "./tool-approval-cards";

const write: PermissionRequest = {
  id: "write",
  name: "write_file",
  arguments: '{"path":"<img src=x onerror=alert(1)>","content":"hi"}',
};
const search: PermissionRequest = {
  id: "search",
  name: "web_search",
  arguments: '{"query":"stars"}',
};
const clock: PermissionRequest = { id: "clock", name: "clock", arguments: "" };

function setup(initial: PermissionRequest[] = []) {
  const onDecide = vi.fn();
  const view = render(
    <>
      <button>Before</button>
      <textarea aria-label="Composer" />
      <ToolApprovalCards requests={initial} onDecide={onDecide} />
    </>,
  );
  const update = (requests: PermissionRequest[]) =>
    view.rerender(
      <>
        <button>Before</button>
        <textarea aria-label="Composer" />
        <ToolApprovalCards requests={requests} onDecide={onDecide} />
      </>,
    );
  return { onDecide, update };
}

const card = (name: string) =>
  screen.getByRole("group", { name: `Allow ${name}?` });

describe("ToolApprovalCards", () => {
  it("renders no cards without requests", () => {
    setup();
    expect(screen.queryByRole("region", { name: "Tool approvals" })).toBeNull();
  });

  it("shows the tool, its arguments as text and a risk hint", () => {
    setup([write, clock]);
    const writeCard = card("write_file");
    expect(writeCard).toHaveAccessibleDescription(/May make changes/);
    expect(writeCard).toHaveAttribute("data-risk", "changes");
    expect(
      within(writeCard).getByRole("region", { name: "Arguments" }),
    ).toHaveTextContent('"path": "<img src=x onerror=alert(1)>"');
    expect(writeCard.querySelector("img")).toBeNull();
    expect(within(card("clock")).getByText("No arguments.")).toBeVisible();
    expect(card("clock")).toHaveAttribute("data-risk", "unknown");
  });

  it("sends one decision per request and marks it as sent", async () => {
    const user = userEvent.setup();
    const { onDecide } = setup([write, search]);
    const approve = screen.getByRole("button", { name: "Approve write_file" });
    await user.click(approve);
    await user.click(approve);
    await user.click(screen.getByRole("button", { name: "Deny write_file" }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(write, true);
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(within(card("write_file")).getByRole("status")).toHaveTextContent(
      "Approving…",
    );

    await user.click(screen.getByRole("button", { name: "Deny web_search" }));
    expect(onDecide).toHaveBeenLastCalledWith(search, false);
    expect(within(card("web_search")).getByRole("status")).toHaveTextContent(
      "Denying…",
    );
  });

  it("focuses a new request and returns focus after the last decision", async () => {
    const user = userEvent.setup();
    const { update } = setup();
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();

    update([write]);
    expect(card("write_file")).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Approve write_file" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    // The decided card keeps focus until the backend confirms it.
    expect(
      screen.getByRole("button", { name: "Approve write_file" }),
    ).toHaveFocus();

    update([]);
    expect(before).toHaveFocus();
  });

  it("moves focus through repeated approvals", async () => {
    const user = userEvent.setup();
    const { onDecide, update } = setup();
    update([write, search, clock]);
    expect(card("write_file")).toHaveFocus();

    await user.click(
      screen.getByRole("button", { name: "Approve write_file" }),
    );
    expect(card("web_search")).toHaveFocus();
    update([search, clock]);
    expect(card("web_search")).toHaveFocus();

    await user.click(
      screen.getByRole("button", { name: "Approve web_search" }),
    );
    expect(card("clock")).toHaveFocus();
    // A confirmation for an earlier card does not pull focus back.
    update([clock]);
    expect(card("clock")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Deny clock" }));
    expect(
      onDecide.mock.calls.map(([request, ok]) => [request.id, ok]),
    ).toEqual([
      ["write", true],
      ["search", true],
      ["clock", false],
    ]);
  });

  it("refocuses the next card when the focused card is removed", async () => {
    const user = userEvent.setup();
    const { update } = setup([write, search]);
    card("write_file").focus();
    await user.click(
      screen.getByRole("button", { name: "Approve write_file" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Approve web_search" }),
    );
    expect(
      screen.getByRole("button", { name: "Approve web_search" }),
    ).toHaveFocus();

    // web_search times out on the backend first.
    update([write]);
    expect(card("write_file")).toHaveFocus();
  });

  it("does not steal focus from text entry but announces the request", async () => {
    const { update } = setup();
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();
    update([write]);
    expect(composer).toHaveFocus();
    expect(screen.getByText("1 tool waiting for approval")).toBeInTheDocument();
  });
});
