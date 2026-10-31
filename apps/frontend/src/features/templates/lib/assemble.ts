import type { TemplateDocument } from "@/lib/client";

/** Assembly rules follow ADR-0026; the server has already validated the document. */
export type TemplateField = TemplateDocument["fields"][number];
export type FieldValue = string | string[];
export type FieldValues = Record<string, FieldValue>;

type Leaf = { type: "text"; text: string } | { type: "field"; key: string };

export type BodySegment =
  | Leaf
  /** `{{#key}}…{{/key}}`: kept only when field `key` has a value. */
  | { type: "section"; key: string; segments: Leaf[] };

const TAG = /^\{\{([#/]?)([a-z][a-z0-9_]{0,31})\}\}/;

/**
 * Splits a body into literal text, placeholders and conditional sections;
 * `\{{` is a literal `{{`. Mirrors the server grammar but never throws: tags a
 * draft has not balanced yet stay literal or unwrap, so editor previews of an
 * invalid body still render.
 */
export function splitBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let open: { key: string; tag: string; segments: Leaf[] } | null = null;
  let literal = "";
  const target = () => open?.segments ?? segments;
  const flush = () => {
    if (literal) target().push({ type: "text", text: literal });
    literal = "";
  };
  let i = 0;
  while (i < body.length) {
    if (body.startsWith("\\{{", i)) {
      literal += "{{";
      i += 3;
      continue;
    }
    const match = body.startsWith("{{", i) ? TAG.exec(body.slice(i)) : null;
    const sigil = match?.[1];
    const key = match?.[2] ?? "";
    const tag = match?.[0] ?? "";
    if (sigil === "") {
      flush();
      target().push({ type: "field", key });
    } else if (sigil === "#" && !open) {
      flush();
      open = { key, tag, segments: [] };
    } else if (sigil === "/" && open?.key === key) {
      flush();
      segments.push({ type: "section", key, segments: open.segments });
      open = null;
    } else {
      literal += body[i];
      i += 1;
      continue;
    }
    i += tag.length;
  }
  flush();
  if (open) {
    // Unclosed: keep its text, including the opening tag, as written.
    const unclosed: { tag: string; segments: Leaf[] } = open;
    segments.push({ type: "text", text: unclosed.tag }, ...unclosed.segments);
  }
  return segments;
}

/** Placeholder keys used anywhere in the body, including inside sections. */
export function placeholderKeys(segments: BodySegment[]) {
  return new Set(
    segments.flatMap((segment) =>
      segment.type === "field"
        ? [segment.key]
        : segment.type === "section"
          ? segment.segments.flatMap((child) =>
              child.type === "field" ? [child.key] : [],
            )
          : [],
    ),
  );
}

/** Starting values; only the guided level pre-fills defaults. */
export function initialValues(
  document: TemplateDocument,
  withDefaults = true,
): FieldValues {
  return Object.fromEntries(
    document.fields.map((field) => [
      field.key,
      field.kind === "examples"
        ? [...((withDefaults && field.default) || [])]
        : (withDefaults && field.default) || "",
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
  const resolve = (segment: Leaf): AssembledSegment => {
    if (segment.type === "text") return segment;
    const field = fields.get(segment.key);
    return {
      type: "field",
      key: segment.key,
      label: field?.label ?? segment.key,
      text: field ? renderValue(field, values[segment.key]) : "",
    };
  };
  return splitBody(document.body).flatMap((segment) => {
    if (segment.type !== "section") return [resolve(segment)];
    const field = fields.get(segment.key);
    // An empty field drops its whole section, surrounding text included.
    return field && isFilled(field, values[segment.key])
      ? segment.segments.map(resolve)
      : [];
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
