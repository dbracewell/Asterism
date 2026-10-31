import type { TemplateDocument } from "@/lib/client";
import { splitBody, type TemplateField } from "./assemble";

/**
 * Editable form of a template document. The server parser (ADR-0026) is
 * authoritative; `validateDraft` mirrors its rules so the editor can explain
 * problems before saving.
 */
export type FieldKind = TemplateField["kind"];

export type DraftField = {
  /** Stable React identity; keys are editable so they cannot serve. */
  uid: string;
  kind: FieldKind;
  key: string;
  label: string;
  help: string;
  required: boolean;
  /** Default for text and select fields; empty means no default. */
  defaultText: string;
  /** Select options, one per line. */
  options: string;
  /** Default examples. */
  examples: string[];
  /** The key this field's placeholders currently use in the body. */
  bodyKey: string;
  /** Whether the key still follows the label (new fields until the key is edited). */
  autoKey: boolean;
};

export type TemplateDraft = {
  name: string;
  description: string;
  body: string;
  fields: DraftField[];
};

export const LIMITS = {
  documentBytes: 65_536,
  name: 80,
  description: 500,
  body: 16_000,
  fields: 32,
  label: 80,
  help: 500,
  shortText: 500,
  longText: 8_000,
  options: 20,
  option: 120,
  examples: 10,
  example: 4_000,
} as const;

export const KIND_LABELS: Record<FieldKind, string> = {
  short_text: "Short text",
  long_text: "Long text",
  select: "Select",
  examples: "Examples",
};

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

let nextUid = 0;
const uid = () => `field-${++nextUid}`;

export function fromDocument(document: TemplateDocument): TemplateDraft {
  return {
    name: document.name,
    description: document.description,
    body: document.body,
    fields: document.fields.map((field) => ({
      uid: uid(),
      kind: field.kind,
      key: field.key,
      label: field.label,
      help: field.help ?? "",
      required: field.required ?? false,
      defaultText:
        field.kind === "examples" ? "" : ((field.default as string) ?? ""),
      options: field.kind === "select" ? field.options.join("\n") : "",
      examples: field.kind === "examples" ? [...(field.default ?? [])] : [],
      bodyKey: field.key,
      autoKey: false,
    })),
  };
}

export function parseOptions(options: string) {
  return options
    .split("\n")
    .map((option) => option.trim())
    .filter(Boolean);
}

function toField(field: DraftField): TemplateField {
  const base = {
    key: field.key,
    label: field.label,
    help: field.help,
    required: field.required,
  };
  switch (field.kind) {
    case "examples": {
      const examples = field.examples.filter((example) => example.trim());
      return {
        ...base,
        kind: "examples",
        default: examples.length ? examples : null,
      };
    }
    case "select":
      return {
        ...base,
        kind: "select",
        options: parseOptions(field.options),
        default: field.defaultText || null,
      };
    default:
      return { ...base, kind: field.kind, default: field.defaultText || null };
  }
}

export function toDocument(draft: TemplateDraft): TemplateDocument {
  return {
    name: draft.name,
    description: draft.description,
    fields: draft.fields.map(toField),
    body: draft.body,
  };
}

/** Comparable form of a draft, independent of field identities. */
export function draftSignature(draft: TemplateDraft) {
  return JSON.stringify(toDocument(draft));
}

export function documentBytes(draft: TemplateDraft) {
  return new TextEncoder().encode(draftSignature(draft)).length;
}

export function blankDraft(): TemplateDraft {
  return {
    name: "My template",
    description: "Describe when to use this template.",
    body: "{{task}}",
    fields: [
      {
        ...newField("task"),
        kind: "long_text",
        label: "Task",
        required: true,
      },
    ],
  };
}

export function newField(key: string): DraftField {
  return {
    uid: uid(),
    kind: "short_text",
    key,
    label: key
      .split("_")
      .filter(Boolean)
      .join(" ")
      .replace(/^./, (first) => first.toUpperCase()),
    help: "",
    required: false,
    defaultText: "",
    options: "",
    examples: [],
    bodyKey: key,
    autoKey: true,
  };
}

/** A key derived from a label, e.g. "Target audience" → `target_audience`. */
export function keyFromLabel(label: string) {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return (/^[a-z]/.test(slug) ? slug : `field_${slug}`)
    .slice(0, 32)
    .replace(/_+$/, "");
}

/**
 * Replaces `{{from}}` placeholders with `{{to}}`, using the same scan as the
 * parser so escaped `\{{from}}` text is left alone.
 */
export function renamePlaceholder(body: string, from: string, to: string) {
  const token = `{{${from}}}`;
  let result = "";
  for (let i = 0; i < body.length; ) {
    if (body.startsWith("\\{{", i)) {
      result += "\\{{";
      i += 3;
    } else if (body.startsWith(token, i)) {
      result += `{{${to}}}`;
      i += token.length;
    } else {
      result += body[i];
      i += 1;
    }
  }
  return result;
}

/**
 * Applies an edit to one field and keeps the body in step: a label edit
 * re-derives an automatic key, a direct key edit stops that, and any change to
 * a valid, unique key renames the field's placeholders in the body.
 */
export function updateField(
  draft: TemplateDraft,
  uid: string,
  edited: DraftField,
): TemplateDraft {
  const previous = draft.fields.find((field) => field.uid === uid);
  if (!previous) return draft;
  const others = draft.fields.filter((field) => field.uid !== uid);
  const taken = new Set(others.map((field) => field.key));
  let next = edited;
  if (next.key !== previous.key) next = { ...next, autoKey: false };
  else if (next.autoKey && next.label !== previous.label) {
    const base = keyFromLabel(next.label);
    if (base) {
      let key = base;
      for (let n = 2; taken.has(key); n += 1)
        key = `${base.slice(0, 32 - String(n).length - 1)}_${n}`;
      next = { ...next, key };
    }
  }
  let body = draft.body;
  const owned = !others.some((field) => field.bodyKey === next.bodyKey);
  if (
    next.key !== next.bodyKey &&
    KEY_PATTERN.test(next.key) &&
    !taken.has(next.key)
  ) {
    // Never rename placeholders another field also claims.
    if (owned) body = renamePlaceholder(body, next.bodyKey, next.key);
    next = { ...next, bodyKey: next.key };
  }
  return {
    ...draft,
    body,
    fields: draft.fields.map((field) => (field.uid === uid ? next : field)),
  };
}

/** The first `field_N` key not already taken. */
export function nextFieldKey(fields: DraftField[]) {
  const taken = new Set(fields.map((field) => field.key));
  let n = fields.length + 1;
  while (taken.has(`field_${n}`)) n += 1;
  return `field_${n}`;
}

/** Changing kind keeps the shared properties and resets kind-specific ones. */
export function changeKind(field: DraftField, kind: FieldKind): DraftField {
  return { ...field, kind, defaultText: "", options: "", examples: [] };
}

export function duplicateName(name: string) {
  const suffix = " (copy)";
  return name.slice(0, LIMITS.name - suffix.length).trimEnd() + suffix;
}

export type DraftIssues = {
  /** Problems with the name, description, body or document as a whole. */
  general: string[];
  /** Problems keyed by `DraftField.uid`. */
  fields: Record<string, string[]>;
};

const blank = (value: string) => !value.trim();
const tooLong = (value: string, limit: number) => [...value].length > limit;

/** Body placeholder keys, or a message if the body is malformed. */
function placeholders(body: string): Set<string> | string {
  // Same left-to-right scan as the server parser.
  for (let i = 0; i < body.length; ) {
    if (body.startsWith("\\{{", i)) i += 3;
    else if (body.startsWith("{{", i)) {
      const match = /^\{\{[a-z][a-z0-9_]{0,31}\}\}/.exec(body.slice(i));
      if (!match)
        return `Malformed placeholder at character ${i}; use {{key}}, or \\{{ for a literal {{.`;
      i += match[0].length;
    } else i += 1;
  }
  return new Set(
    splitBody(body).flatMap((segment) =>
      segment.type === "field" ? [segment.key] : [],
    ),
  );
}

export function validateDraft(draft: TemplateDraft): DraftIssues {
  const general: string[] = [];
  const fields: Record<string, string[]> = {};
  if (blank(draft.name)) general.push("Name is required.");
  else if (tooLong(draft.name, LIMITS.name))
    general.push(`Name must be at most ${LIMITS.name} characters.`);
  if (blank(draft.description)) general.push("Description is required.");
  else if (tooLong(draft.description, LIMITS.description))
    general.push(
      `Description must be at most ${LIMITS.description} characters.`,
    );
  if (blank(draft.body)) general.push("Body is required.");
  else if (tooLong(draft.body, LIMITS.body))
    general.push(
      `Body must be at most ${LIMITS.body.toLocaleString()} characters.`,
    );
  if (!draft.fields.length) general.push("Add at least one field.");
  if (draft.fields.length > LIMITS.fields)
    general.push(`Use at most ${LIMITS.fields} fields.`);

  const counts = new Map<string, number>();
  for (const field of draft.fields)
    counts.set(field.key, (counts.get(field.key) ?? 0) + 1);

  for (const field of draft.fields) {
    const issues: string[] = [];
    if (!KEY_PATTERN.test(field.key))
      issues.push(
        "Key must start with a lowercase letter and use only a–z, 0–9 and _ (up to 32 characters).",
      );
    else if ((counts.get(field.key) ?? 0) > 1)
      issues.push(`Key “${field.key}” is used by another field.`);
    if (blank(field.label)) issues.push("Label is required.");
    else if (tooLong(field.label, LIMITS.label))
      issues.push(`Label must be at most ${LIMITS.label} characters.`);
    if (tooLong(field.help, LIMITS.help))
      issues.push(`Help must be at most ${LIMITS.help} characters.`);
    if (
      field.kind === "short_text" &&
      tooLong(field.defaultText, LIMITS.shortText)
    )
      issues.push(`Default must be at most ${LIMITS.shortText} characters.`);
    if (
      field.kind === "long_text" &&
      tooLong(field.defaultText, LIMITS.longText)
    )
      issues.push(
        `Default must be at most ${LIMITS.longText.toLocaleString()} characters.`,
      );
    if (field.kind === "select") {
      const options = parseOptions(field.options);
      if (!options.length) issues.push("Add at least one option.");
      if (options.length > LIMITS.options)
        issues.push(`Use at most ${LIMITS.options} options.`);
      if (new Set(options).size !== options.length)
        issues.push("Options must be unique.");
      if (options.some((option) => tooLong(option, LIMITS.option)))
        issues.push(`Each option must be at most ${LIMITS.option} characters.`);
      if (field.defaultText && !options.includes(field.defaultText))
        issues.push("Default must be one of the options.");
    }
    if (field.kind === "examples") {
      const examples = field.examples.filter((example) => example.trim());
      if (examples.length > LIMITS.examples)
        issues.push(`Use at most ${LIMITS.examples} default examples.`);
      if (examples.some((example) => tooLong(example, LIMITS.example)))
        issues.push(
          `Each example must be at most ${LIMITS.example.toLocaleString()} characters.`,
        );
    }
    if (issues.length) fields[field.uid] = issues;
  }

  const used = placeholders(draft.body);
  if (typeof used === "string") general.push(used);
  else {
    const keys = new Set(draft.fields.map((field) => field.key));
    const unknown = [...used].filter((key) => !keys.has(key)).sort();
    if (unknown.length)
      general.push(
        `Placeholders without a matching field: ${unknown.join(", ")}.`,
      );
    for (const field of draft.fields)
      if (KEY_PATTERN.test(field.key) && !used.has(field.key))
        (fields[field.uid] ??= []).push(
          `Not used in the body; insert {{${field.key}}} or remove the field.`,
        );
  }
  if (documentBytes(draft) > LIMITS.documentBytes)
    general.push(
      `The template exceeds ${LIMITS.documentBytes.toLocaleString()} UTF-8 bytes.`,
    );
  return { general, fields };
}

export function hasIssues(issues: DraftIssues) {
  return issues.general.length > 0 || Object.keys(issues.fields).length > 0;
}
