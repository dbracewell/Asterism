import type { TemplateDocument, TemplateUse } from "@/lib/client";
import type { TemplateField } from "./assemble";

/**
 * Scaffolding levels (US-51.5). Every template supports all three; the level
 * only changes how much help the builder shows, and is recorded in provenance.
 */
export type ScaffoldingLevel = TemplateUse["level"];

export const LEVELS: {
  value: ScaffoldingLevel;
  label: string;
  description: string;
}[] = [
  {
    value: "guided",
    label: "Guided",
    description: "Every field, with help, examples and suggested defaults.",
  },
  {
    value: "standard",
    label: "Standard",
    description:
      "The required fields only, starting empty. Optional fields are under More.",
  },
  {
    value: "freeform",
    label: "Freeform",
    description:
      "Write the prompt yourself, with a checklist of what it should cover.",
  },
];

export function levelLabel(level: ScaffoldingLevel) {
  return LEVELS.find((option) => option.value === level)?.label ?? level;
}

export function isScaffoldingLevel(value: unknown): value is ScaffoldingLevel {
  return LEVELS.some((level) => level.value === value);
}

/** Fields shown up front, and those tucked under "More" at the standard level. */
export function visibleFields(
  document: TemplateDocument,
  level: ScaffoldingLevel,
): { primary: TemplateField[]; more: TemplateField[] } {
  if (level === "freeform") return { primary: [], more: [] };
  if (level === "guided") return { primary: [...document.fields], more: [] };
  return {
    primary: document.fields.filter((field) => field.required),
    more: document.fields.filter((field) => !field.required),
  };
}

/**
 * What a good prompt built from this template covers. Templates without a
 * checklist get one derived from their fields.
 */
export function checklistFor(document: TemplateDocument): string[] {
  if (document.checklist?.length) return [...document.checklist];
  return document.fields.map((field) =>
    field.help ? `${field.label}: ${field.help}` : field.label,
  );
}
