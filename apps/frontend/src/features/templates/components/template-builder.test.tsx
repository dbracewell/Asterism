import type { TemplateDocument } from "@/lib/client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TemplateBuilder } from "./template-builder";

const template: TemplateDocument = {
  name: "RTF",
  description: "Role, Task, Format",
  fields: [
    {
      kind: "short_text",
      key: "role",
      label: "Role",
      help: "Who should answer?",
      required: true,
      default: "a teacher",
    },
    { kind: "long_text", key: "task", label: "Task", required: true },
    {
      kind: "select",
      key: "format",
      label: "Format",
      options: ["a list", "a table"],
    },
    { kind: "examples", key: "examples", label: "Examples" },
  ],
  body: "Act as {{role}}. {{task}} Answer as {{format}}.\n{{examples}}",
};

function setup() {
  const onUse = vi.fn();
  render(<TemplateBuilder template={template} onUse={onUse} />);
  const preview = screen.getByTestId("template-preview");
  const segment = (key: string) =>
    preview.querySelector(`[data-field="${key}"]`) as HTMLElement;
  const field = (key: string) =>
    document.querySelector(
      `[data-slot="field"][data-field="${key}"]`,
    ) as HTMLElement;
  return { onUse, preview, segment, field };
}

it("generates a control for each field kind and shows defaults in the preview", () => {
  const { preview, segment } = setup();
  expect(screen.getByLabelText(/Role/)).toHaveValue("a teacher");
  expect(screen.getByLabelText(/Role/)).toHaveAccessibleDescription(
    "Who should answer?",
  );
  expect(screen.getByLabelText(/Task/).tagName).toBe("TEXTAREA");
  expect(screen.getByRole("combobox", { name: "Format" })).toBeInTheDocument();
  expect(screen.getByLabelText("Examples 1")).toBeInTheDocument();
  expect(segment("role")).toHaveTextContent("a teacher");
  // Empty fields show their label as a placeholder, not as prompt text.
  expect(segment("task")).toHaveTextContent("[Task]");
  expect(preview).toHaveTextContent("Act as a teacher. [Task] Answer as");
});

it("updates the preview as the user types and adds examples", async () => {
  const user = userEvent.setup();
  const { segment } = setup();
  await user.type(screen.getByLabelText(/Task/), "Explain gravity.");
  expect(segment("task")).toHaveTextContent("Explain gravity.");
  await user.type(screen.getByLabelText("Examples 1"), "Q: 1+1\nA: 2");
  await user.click(screen.getByRole("button", { name: "Add example" }));
  await user.type(screen.getByLabelText("Examples 2"), "Q: 2+2");
  expect(segment("examples").textContent).toBe(
    "Example 1:\nQ: 1+1\nA: 2\n\nExample 2:\nQ: 2+2",
  );
  await user.click(screen.getByRole("button", { name: "Remove examples 1" }));
  expect(segment("examples").textContent).toBe("Example 1:\nQ: 2+2");
});

it("links a field and its preview segment on focus and hover", async () => {
  const user = userEvent.setup();
  const { segment, field } = setup();
  await user.click(screen.getByLabelText(/Task/));
  expect(field("task")).toHaveAttribute("data-active");
  expect(segment("task")).toHaveAttribute("data-active");
  expect(segment("role")).not.toHaveAttribute("data-active");
  await user.tab();
  expect(field("task")).not.toHaveAttribute("data-active");
  fireEvent.mouseEnter(segment("role"));
  expect(field("role")).toHaveAttribute("data-active");
  expect(segment("role")).toHaveAttribute("data-active");
  fireEvent.mouseLeave(segment("role"));
  expect(field("role")).not.toHaveAttribute("data-active");
  fireEvent.mouseEnter(field("format"));
  expect(segment("format")).toHaveAttribute("data-active");
});

it("validates required fields before using the prompt", async () => {
  const user = userEvent.setup();
  const { onUse } = setup();
  await user.clear(screen.getByLabelText(/Role/));
  await user.click(screen.getByRole("button", { name: "Use prompt" }));
  expect(onUse).not.toHaveBeenCalled();
  expect(
    screen.getByText("Fill in the required fields first."),
  ).toBeInTheDocument();
  expect(screen.getByText("Task is required.")).toBeInTheDocument();
  const role = screen.getByLabelText(/Role/);
  expect(role).toHaveFocus();
  expect(role).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText(/Task/)).toHaveAttribute("aria-invalid", "true");
  await user.type(role, "a coach");
  await user.type(screen.getByLabelText(/Task/), "Plan a run.");
  expect(screen.queryByText("Role is required.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Use prompt" }));
  expect(onUse).toHaveBeenCalledWith(
    "Act as a coach. Plan a run. Answer as .\n",
  );
});

it("selects options and clears optional selects", async () => {
  const user = userEvent.setup();
  const { segment } = setup();
  await user.click(screen.getByRole("combobox", { name: "Format" }));
  await user.click(screen.getByRole("option", { name: "a table" }));
  expect(segment("format")).toHaveTextContent("a table");
  await user.click(screen.getByRole("combobox", { name: "Format" }));
  await user.click(screen.getByRole("option", { name: "None" }));
  expect(within(segment("format")).getByText("[Format]")).toBeInTheDocument();
});
