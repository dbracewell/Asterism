import type { TemplateDocument } from "@/lib/client";
import { describe, expect, it } from "vitest";
import {
  assemble,
  assembleSegments,
  initialValues,
  missingRequired,
  splitBody,
} from "./assemble";

const template: TemplateDocument = {
  name: "Few-shot",
  description: "Examples",
  fields: [
    { kind: "short_text", key: "task", label: "Task", required: true },
    {
      kind: "select",
      key: "tone",
      label: "Tone",
      options: ["neutral", "formal"],
      default: "neutral",
    },
    { kind: "examples", key: "examples", label: "Examples", default: ["a"] },
    { kind: "long_text", key: "notes", label: "Notes" },
  ],
  body: "Do {{task}} in a {{tone}} tone.\n\n{{examples}}\n\\{{literal}} {{notes}}",
};

describe("splitBody", () => {
  it("splits placeholders, unescapes \\{{ and keeps other text literal", () => {
    expect(splitBody("A {{x}} \\{{y}} }} \\ {{x}}")).toEqual([
      { type: "text", text: "A " },
      { type: "field", key: "x" },
      { type: "text", text: " {{y}} }} \\ " },
      { type: "field", key: "x" },
    ]);
  });
});

describe("assemble", () => {
  it("fills defaults, renders examples as numbered blocks and empties optional fields", () => {
    const values = initialValues(template);
    expect(values).toEqual({
      task: "",
      tone: "neutral",
      examples: ["a"],
      notes: "",
    });
    values.task = "the thing";
    values.examples = ["one", "  ", "two"];
    expect(assemble(template, values)).toBe(
      "Do the thing in a neutral tone.\n\nExample 1:\none\n\nExample 2:\ntwo\n{{literal}} ",
    );
  });

  it("does not re-parse placeholder syntax inside values", () => {
    const values = { ...initialValues(template), task: "{{tone}}" };
    expect(assemble(template, values)).toContain("Do {{tone}} in a neutral");
  });

  it("labels each field segment for preview linking", () => {
    const segments = assembleSegments(template, initialValues(template));
    expect(segments[1]).toEqual({
      type: "field",
      key: "task",
      label: "Task",
      text: "",
    });
  });

  it("reports required fields without a usable value", () => {
    const values = initialValues(template);
    expect(missingRequired(template, values)).toEqual(["task"]);
    values.task = "   ";
    expect(missingRequired(template, values)).toEqual(["task"]);
    values.task = "x";
    expect(missingRequired(template, values)).toEqual([]);
  });
});
