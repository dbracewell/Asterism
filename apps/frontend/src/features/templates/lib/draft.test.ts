import type { TemplateDocument } from "@/lib/client";
import { describe, expect, it } from "vitest";
import {
  blankDraft,
  changeKind,
  draftSignature,
  duplicateName,
  fromDocument,
  hasIssues,
  keyFromLabel,
  newField,
  renamePlaceholder,
  nextFieldKey,
  toDocument,
  updateField,
  validateDraft,
  type TemplateDraft,
} from "./draft";

const document: TemplateDocument = {
  name: "RTF",
  description: "Role, Task, Format",
  fields: [
    {
      kind: "short_text",
      key: "role",
      label: "Role",
      help: "Who?",
      required: true,
      example: null,
      default: "a teacher",
    },
    {
      kind: "long_text",
      key: "task",
      label: "Task",
      help: "",
      required: true,
      example: null,
      default: null,
    },
    {
      kind: "select",
      key: "format",
      label: "Format",
      help: "",
      required: false,
      example: null,
      options: ["a list", "a table"],
      default: "a list",
    },
    {
      kind: "examples",
      key: "shots",
      label: "Examples",
      help: "",
      required: false,
      example: null,
      default: ["One", "Two"],
    },
  ],
  body: "Act as {{role}}. {{task}} as {{format}}.\n{{shots}}",
  checklist: [],
};

const messages = (draft: TemplateDraft) => {
  const issues = validateDraft(draft);
  return [...issues.general, ...Object.values(issues.fields).flat()];
};

describe("template drafts", () => {
  it("round-trips a document without changes", () => {
    const draft = fromDocument(document);
    expect(toDocument(draft)).toEqual(document);
    expect(hasIssues(validateDraft(draft))).toBe(false);
    expect(draftSignature(fromDocument(document))).toBe(draftSignature(draft));
  });

  it("round-trips guided examples and the freeform checklist", () => {
    const draft = fromDocument({
      ...document,
      checklist: ["Name a role.", "State the task."],
    });
    expect(draft.checklist).toBe("Name a role.\nState the task.");
    draft.fields[1].example = "Plan a 5k.";
    draft.fields[0].example = "   ";
    draft.checklist = " Name a role. \n\n State the task. ";
    const result = toDocument(draft);
    expect(result.fields[1].example).toBe("Plan a 5k.");
    expect(result.fields[0].example).toBeNull();
    expect(result.checklist).toEqual(["Name a role.", "State the task."]);
  });

  it("validates sections, examples and checklist limits like the server", () => {
    const draft = fromDocument(document);
    const body = (value: string) => messages({ ...draft, body: value });
    const base = "{{role}} {{task}} {{format}} {{shots}}";
    expect(body(`${base}{{#format}}as {{format}}{{/format}}`)).toEqual([]);
    expect(body(`${base}{{#format}}x`)).toEqual([
      "Section “format” opened at character 38 is never closed.",
    ]);
    expect(body(`${base}{{/format}}`)[0]).toMatch(/has no matching open/);
    expect(body(`${base}{{#role}}{{#task}}{{/task}}{{/role}}`)[0]).toMatch(
      /cannot nest/,
    );
    expect(body(`${base}{{#nope}}x{{/nope}}`)).toEqual([
      "Sections without a matching field: nope.",
    ]);
    // A section tag alone does not count as using the field.
    expect(
      body("{{role}} {{task}} {{format}}{{#shots}}x{{/shots}}").some((m) =>
        m.startsWith("Not used in the body"),
      ),
    ).toBe(true);
    draft.fields[0].example = "x".repeat(501);
    draft.checklist = Array.from({ length: 13 }, (_, i) => `Item ${i}`).join(
      "\n",
    );
    expect(messages(draft)).toEqual(
      expect.arrayContaining([
        "Example must be at most 500 characters.",
        "Use at most 12 checklist items.",
      ]),
    );
  });

  it("normalizes empty defaults, options and examples", () => {
    const draft = fromDocument(document);
    draft.fields[0].defaultText = "";
    draft.fields[2].options = " a list \n\n a table ";
    draft.fields[3].examples = ["", "  "];
    const result = toDocument(draft);
    expect(result.fields[0]).toMatchObject({ default: null });
    expect(result.fields[2]).toMatchObject({ options: ["a list", "a table"] });
    expect(result.fields[3]).toMatchObject({ default: null });
  });

  it("starts valid when blank or after adding a used field", () => {
    const draft = blankDraft();
    expect(hasIssues(validateDraft(draft))).toBe(false);
    const field = newField(nextFieldKey(draft.fields));
    expect(field).toMatchObject({ key: "field_2", label: "Field 2" });
    expect(
      hasIssues(
        validateDraft({
          ...draft,
          fields: [...draft.fields, field],
          body: `${draft.body} {{field_2}}`,
        }),
      ),
    ).toBe(false);
  });

  it("mirrors the server's placeholder and key rules", () => {
    const draft = fromDocument(document);
    draft.body = "{{role}} {{missing}} {{task}} {{format}} {{shots}}";
    expect(messages(draft)).toContain(
      "Placeholders without a matching field: missing.",
    );
    draft.body = "{{ role }}";
    expect(messages(draft)[0]).toMatch(/^Malformed placeholder at character 0/);
    draft.body = "\\{{literal {{role}} {{task}} {{format}} {{shots}}";
    expect(messages(draft)).toEqual([]);
    draft.fields[1].key = "role";
    expect(messages(draft)).toContain("Key “role” is used by another field.");
    draft.fields[1].key = "Task";
    expect(messages(draft)).toContainEqual(
      expect.stringMatching(/^Key must start with a lowercase/),
    );
  });

  it("flags unused fields, bad select defaults and blank text", () => {
    const draft = fromDocument(document);
    draft.body = "{{role}} {{task}} {{format}}";
    draft.fields[2].options = "a table";
    draft.name = " ";
    draft.fields[0].label = "";
    expect(messages(draft)).toEqual(
      expect.arrayContaining([
        "Name is required.",
        "Label is required.",
        "Default must be one of the options.",
        "Not used in the body; insert {{shots}} or remove the field.",
      ]),
    );
    draft.fields[2].options = "";
    expect(messages(draft)).toContain("Add at least one option.");
  });

  it("enforces the document size limit", () => {
    const draft = fromDocument(document);
    draft.fields[3].examples = Array(10).fill("é".repeat(4_000));
    expect(messages(draft).join()).toMatch(/exceeds 65,536 UTF-8 bytes/);
  });

  it("resets kind-specific values when the kind changes", () => {
    const [, , select] = fromDocument(document).fields;
    expect(changeKind(select, "short_text")).toMatchObject({
      kind: "short_text",
      key: "format",
      defaultText: "",
      options: "",
    });
  });

  it("names duplicates within the name limit", () => {
    expect(duplicateName("RTF")).toBe("RTF (copy)");
    expect(duplicateName("x".repeat(80))).toHaveLength(80);
  });

  describe("keeping the body in step with fields", () => {
    const added = () => {
      const draft = blankDraft();
      const field = newField(nextFieldKey(draft.fields));
      return {
        draft: {
          ...draft,
          fields: [...draft.fields, field],
          body: "{{task}}\n\n{{field_2}}",
        },
        field,
      };
    };

    it("derives a new field's key from its label and renames the placeholder", () => {
      const { draft, field } = added();
      let next = updateField(draft, field.uid, {
        ...field,
        label: "Target audience",
      });
      expect(next.fields[1].key).toBe("target_audience");
      expect(next.body).toBe("{{task}}\n\n{{target_audience}}");
      // A label that matches another key gets a numbered suffix.
      next = updateField(next, field.uid, { ...next.fields[1], label: "Task" });
      expect(next.fields[1].key).toBe("task_2");
      expect(next.body).toBe("{{task}}\n\n{{task_2}}");
      expect(hasIssues(validateDraft(next))).toBe(false);
    });

    it("follows direct key edits, waiting out invalid or taken keys", () => {
      const { draft, field } = added();
      let next = updateField(draft, field.uid, { ...field, key: "" });
      expect(next.body).toBe("{{task}}\n\n{{field_2}}");
      next = updateField(next, field.uid, { ...next.fields[1], key: "task" });
      expect(next.body).toBe("{{task}}\n\n{{field_2}}");
      next = updateField(next, field.uid, { ...next.fields[1], key: "tone" });
      expect(next.body).toBe("{{task}}\n\n{{tone}}");
      // Once the key is edited directly, the label no longer changes it.
      next = updateField(next, field.uid, {
        ...next.fields[1],
        label: "Voice",
      });
      expect(next.fields[1].key).toBe("tone");
    });

    it("keeps saved keys when labels change", () => {
      const draft = fromDocument(document);
      const next = updateField(draft, draft.fields[0].uid, {
        ...draft.fields[0],
        label: "Persona",
      });
      expect(next.fields[0].key).toBe("role");
      expect(next.body).toBe(document.body);
    });

    it("renames only real placeholders", () => {
      expect(renamePlaceholder("\\{{a}} {{a}} {{ab}}", "a", "b")).toBe(
        "\\{{a}} {{b}} {{ab}}",
      );
      expect(
        renamePlaceholder("{{#a}}x {{a}}{{/a}} \\{{#a}} {{#ab}}", "a", "b"),
      ).toBe("{{#b}}x {{b}}{{/b}} \\{{#a}} {{#ab}}");
      expect(keyFromLabel("2nd Draft!")).toBe("field_2nd_draft");
      expect(keyFromLabel("Café notes")).toBe("cafe_notes");
      expect(keyFromLabel("???")).toBe("");
    });
  });
});
