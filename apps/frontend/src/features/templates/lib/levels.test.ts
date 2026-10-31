import type { TemplateDocument } from "@/lib/client";
import { describe, expect, it } from "vitest";
import {
  checklistFor,
  isScaffoldingLevel,
  levelLabel,
  visibleFields,
} from "./levels";

const template: TemplateDocument = {
  name: "RTF",
  description: "Role, Task, Format",
  fields: [
    { kind: "short_text", key: "role", label: "Role", required: true },
    { kind: "long_text", key: "task", label: "Task", help: "What to do." },
    { kind: "short_text", key: "format", label: "Format", required: true },
  ],
  body: "{{role}} {{task}} {{format}}",
};

const keys = (fields: TemplateDocument["fields"]) =>
  fields.map((field) => field.key);

describe("scaffolding levels", () => {
  it("shows every field when guided and hides optional ones when standard", () => {
    const guided = visibleFields(template, "guided");
    expect(keys(guided.primary)).toEqual(["role", "task", "format"]);
    expect(guided.more).toEqual([]);
    const standard = visibleFields(template, "standard");
    expect(keys(standard.primary)).toEqual(["role", "format"]);
    expect(keys(standard.more)).toEqual(["task"]);
    expect(visibleFields(template, "freeform")).toEqual({
      primary: [],
      more: [],
    });
  });

  it("uses the template checklist or derives one from the fields", () => {
    expect(checklistFor(template)).toEqual([
      "Role",
      "Task: What to do.",
      "Format",
    ]);
    expect(checklistFor({ ...template, checklist: ["Name a role."] })).toEqual([
      "Name a role.",
    ]);
  });

  it("recognizes only the three levels", () => {
    expect(["guided", "standard", "freeform"].every(isScaffoldingLevel)).toBe(
      true,
    );
    expect(isScaffoldingLevel("expert")).toBe(false);
    expect(levelLabel("freeform")).toBe("Freeform");
  });
});
