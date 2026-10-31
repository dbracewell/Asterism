import type { TemplateDocument } from "@/lib/client";

/** Assembly rules follow ADR-0026; the server has already validated the document. */
export type TemplateField = TemplateDocument["fields"][number];
export type FieldValue = string | string[];
export type FieldValues = Record<string, FieldValue>;

export type BodySegment =
  | { type: "text"; text: string }
  | { type: "field"; key: string };

const KEY = /^[a-z][a-z0-9_]{0,31}/;

/** Splits a body into literal text and placeholders; `\{{` is a literal `{{`. */
export function splitBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let literal = "";
  let i = 0;
  const flush = () => {
    if (literal) segments.push({ type: "text", text: literal });
    literal = "";
  };
  while (i < body.length) {
    if (body.startsWith("\\{{", i)) {
      literal += "{{";
      i += 3;
      continue;
    }
    if (body.startsWith("{{", i)) {
      const match = KEY.exec(body.slice(i + 2));
      const end = match ? i + 2 + match[0].length : -1;
      if (match && body.startsWith("}}", end)) {
        flush();
        segments.push({ type: "field", key: match[0] });
        i = end + 2;
        continue;
      }
    }
    literal += body[i];
    i += 1;
  }
  flush();
  return segments;
}

export function initialValues(document: TemplateDocument): FieldValues {
  return Object.fromEntries(
    document.fields.map((field) => [
      field.key,
      field.kind === "examples"
        ? [...(field.default ?? [])]
        : (field.default ?? ""),
    ]),
  );
}

/** The text a field contributes to the prompt. */
export function renderValue(
  field: TemplateField,
  value: FieldValue | undefined,
) {
  if (field.kind === "examples") {
    const items = (Array.isArray(value) ? value : []).filter((item) =>
      item.trim(),
    );
    return items
      .map((item, index) => `Example ${index + 1}:\n${item}`)
      .join("\n\n");
  }
  return typeof value === "string" ? value : "";
}

export function isFilled(field: TemplateField, value: FieldValue | undefined) {
  return renderValue(field, value).trim().length > 0;
}

export type AssembledSegment =
  | { type: "text"; text: string }
  | { type: "field"; key: string; label: string; text: string };

export function assembleSegments(
  document: TemplateDocument,
  values: FieldValues,
): AssembledSegment[] {
  const fields = new Map(document.fields.map((field) => [field.key, field]));
  return splitBody(document.body).map((segment) => {
    if (segment.type === "text") return segment;
    const field = fields.get(segment.key);
    return {
      type: "field",
      key: segment.key,
      label: field?.label ?? segment.key,
      text: field ? renderValue(field, values[segment.key]) : "",
    };
  });
}

export function assemble(document: TemplateDocument, values: FieldValues) {
  return assembleSegments(document, values)
    .map((segment) => segment.text)
    .join("");
}

/** Keys of required fields that have no usable value. */
export function missingRequired(
  document: TemplateDocument,
  values: FieldValues,
) {
  return document.fields
    .filter((field) => field.required && !isFilled(field, values[field.key]))
    .map((field) => field.key);
}
