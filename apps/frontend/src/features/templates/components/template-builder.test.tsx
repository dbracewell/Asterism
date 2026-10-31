import type { TemplateDocument } from "@/lib/client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
      example: "a running coach",
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

function setup(
  props: Partial<React.ComponentProps<typeof TemplateBuilder>> = {},
) {
  const onUse = vi.fn();
  render(<TemplateBuilder template={template} onUse={onUse} {...props} />);
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
    "Who should answer? Example: a running coach",
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
    "guided",
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

describe("scaffolding levels", () => {
  it("guided shows every field with its example and default", () => {
    setup();
    expect(screen.getByRole("tab", { name: "Guided" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const role = screen.getByLabelText(/Role/);
    expect(role).toHaveValue("a teacher");
    expect(role).toHaveAccessibleDescription(
      "Who should answer? Example: a running coach",
    );
    for (const name of [/Role/, /Task/])
      expect(screen.getByLabelText(name)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Format" })).toBeVisible();
    expect(screen.getByLabelText("Examples 1")).toBeVisible();
    expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
  });

  it("standard starts empty and hides optional fields behind More", async () => {
    const user = userEvent.setup();
    const { onUse, segment } = setup({ initialLevel: "standard" });
    const role = screen.getByLabelText(/Role/);
    expect(role).toHaveValue("");
    expect(role).toHaveAccessibleDescription("Who should answer?");
    expect(screen.queryByText(/Example: a running coach/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Format" })).toBeNull();
    expect(screen.queryByLabelText("Examples 1")).toBeNull();
    expect(segment("format")).toHaveTextContent("[Format]");
    const more = screen.getByRole("button", { name: "More (2 optional)" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Format" })).toBeVisible();
    expect(screen.getByLabelText("Examples 1")).toBeVisible();
    await user.type(role, "a coach");
    await user.type(screen.getByLabelText(/Task/), "Plan a run.");
    await user.click(screen.getByRole("button", { name: "Use prompt" }));
    expect(onUse).toHaveBeenCalledWith(
      "Act as a coach. Plan a run. Answer as .\n",
      "standard",
    );
  });

  it("freeform shows only a checklist beside a blank prompt", async () => {
    const user = userEvent.setup();
    const { onUse } = setup();
    await user.click(screen.getByRole("tab", { name: "Freeform" }));
    expect(screen.queryByRole("textbox", { name: /Role/ })).toBeNull();
    expect(screen.queryByTestId("template-preview")).toBeNull();
    const checklist = screen.getByTestId("template-checklist");
    // Without a template checklist, items are derived from the fields.
    expect(within(checklist).getAllByRole("checkbox")).toHaveLength(4);
    expect(checklist).toHaveTextContent("Role: Who should answer?");
    const tick = within(checklist).getByRole("checkbox", { name: "Task" });
    await user.click(tick);
    expect(tick).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Use prompt" }));
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByText("Write your prompt first.")).toBeInTheDocument();
    const prompt = screen.getByLabelText(/Your prompt/);
    expect(prompt).toHaveFocus();
    await user.type(prompt, "Act as a coach and plan my week.");
    await user.click(screen.getByRole("button", { name: "Use prompt" }));
    expect(onUse).toHaveBeenCalledWith(
      "Act as a coach and plan my week.",
      "freeform",
    );
  });

  it("uses the template's own checklist when it has one", async () => {
    const user = userEvent.setup();
    render(
      <TemplateBuilder
        template={{ ...template, checklist: ["Name a role.", "Say why."] }}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Freeform" }));
    expect(
      within(screen.getByTestId("template-checklist"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Name a role.", "Say why."]);
  });

  it("keeps typed values across levels and fills empty fields when guided", async () => {
    const user = userEvent.setup();
    setup({ initialLevel: "standard" });
    await user.type(screen.getByLabelText(/Task/), "Plan a run.");
    await user.click(screen.getByRole("tab", { name: "Freeform" }));
    await user.click(screen.getByRole("tab", { name: "Guided" }));
    expect(screen.getByLabelText(/Task/)).toHaveValue("Plan a run.");
    expect(screen.getByLabelText(/Role/)).toHaveValue("a teacher");
    await user.clear(screen.getByLabelText(/Role/));
    await user.type(screen.getByLabelText(/Role/), "a coach");
    await user.click(screen.getByRole("tab", { name: "Standard" }));
    expect(screen.getByLabelText(/Role/)).toHaveValue("a coach");
  });
});
