import type { TemplateDocument } from "@/lib/client";
import { describe, expect, it } from "vitest";
import {
  assemble,
  assembleSegments,
  initialValues,
  missingRequired,
  splitBody,
  type FieldValues,
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

  it("groups conditional sections and leaves unbalanced tags as text", () => {
    expect(splitBody("A{{#x}} for {{x}}{{/x}}.")).toEqual([
      { type: "text", text: "A" },
      {
        type: "section",
        key: "x",
        segments: [
          { type: "text", text: " for " },
          { type: "field", key: "x" },
        ],
      },
      { type: "text", text: "." },
    ]);
    // Drafts may be mid-edit: a stray close is text, an unclosed open unwraps.
    expect(splitBody("{{/x}}{{#y}}b {{y}}")).toEqual([
      { type: "text", text: "{{/x}}" },
      { type: "text", text: "{{#y}}" },
      { type: "text", text: "b " },
      { type: "field", key: "y" },
    ]);
  });
});

describe("conditional sections", () => {
  const sectioned: TemplateDocument = {
    ...template,
    body: "Do {{task}}.{{#tone}} Use a {{tone}} tone.{{/tone}}{{#notes}}\nNotes: {{notes}}{{/notes}} {{examples}}",
  };

  it("drop their text when the field is empty and keep it when filled", () => {
    const values: FieldValues = {
      ...initialValues(sectioned),
      task: "x",
      examples: [],
    };
    expect(assemble(sectioned, values)).toBe("Do x. Use a neutral tone. ");
    values.tone = "";
    values.notes = "be brief";
    expect(assemble(sectioned, values)).toBe("Do x.\nNotes: be brief ");
  });

  it("starts empty without defaults when asked", () => {
    expect(initialValues(sectioned, false)).toEqual({
      task: "",
      tone: "",
      examples: [],
      notes: "",
    });
    expect(
      assemble(sectioned, { ...initialValues(sectioned, false), task: "x" }),
    ).toBe("Do x. ");
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
