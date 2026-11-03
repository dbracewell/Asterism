import type { RubricDocument } from "@/lib/client";

/**
 * Editable rubric state (US-57.1). Each criterion keeps one descriptor per
 * level, aligned by index, so level edits also reshape every criterion.
 * Validation mirrors the server parser; the server stays authoritative.
 */
export type RubricLevelDraft = { uid: string; label: string };
export type RubricCriterionDraft = {
  uid: string;
  label: string;
  description: string;
  descriptors: string[];
};
export type RubricDraft = {
  name: string;
  description: string;
  levels: RubricLevelDraft[];
  criteria: RubricCriterionDraft[];
};

export const RUBRIC_LIMITS = {
  name: 80,
  description: 500,
  minLevels: 2,
  levels: 6,
  levelLabel: 40,
  criteria: 12,
  criterionLabel: 80,
  criterionDescription: 500,
  descriptor: 1000,
  documentBytes: 65_536,
} as const;

/** Reserved for the closing section of a feedback reply. */
export const OVERALL = "Overall";

const uid = () => crypto.randomUUID();

export function blankRubricDraft(): RubricDraft {
  return {
    name: "",
    description: "",
    levels: ["Exemplary", "Proficient", "Developing", "Beginning"].map(
      (label) => ({ uid: uid(), label }),
    ),
    criteria: [newCriterion(4)],
  };
}

export function newCriterion(levels: number): RubricCriterionDraft {
  return {
    uid: uid(),
    label: "",
    description: "",
    descriptors: Array.from({ length: levels }, () => ""),
  };
}

export function rubricFromDocument(document: RubricDocument): RubricDraft {
  return {
    name: document.name,
    description: document.description,
    levels: document.levels.map((label) => ({ uid: uid(), label })),
    criteria: document.criteria.map((criterion) => ({
      uid: uid(),
      label: criterion.label,
      description: criterion.description ?? "",
      descriptors: [...criterion.descriptors],
    })),
  };
}

export function rubricToDocument(draft: RubricDraft): RubricDocument {
  return {
    name: draft.name,
    description: draft.description,
    levels: draft.levels.map((level) => level.label),
    criteria: draft.criteria.map((criterion) => ({
      label: criterion.label,
      description: criterion.description,
      descriptors: criterion.descriptors,
    })),
  };
}

/** Comparable draft content, ignoring the editor-only identifiers. */
export const rubricSignature = (draft: RubricDraft) =>
  JSON.stringify(rubricToDocument(draft));

export const rubricBytes = (draft: RubricDraft) =>
  new TextEncoder().encode(rubricSignature(draft)).length;

export function addLevel(draft: RubricDraft): RubricDraft {
  return {
    ...draft,
    levels: [...draft.levels, { uid: uid(), label: "" }],
    criteria: draft.criteria.map((criterion) => ({
      ...criterion,
      descriptors: [...criterion.descriptors, ""],
    })),
  };
}

export function removeLevel(draft: RubricDraft, index: number): RubricDraft {
  return {
    ...draft,
    levels: draft.levels.filter((_, position) => position !== index),
    criteria: draft.criteria.map((criterion) => ({
      ...criterion,
      descriptors: criterion.descriptors.filter(
        (_, position) => position !== index,
      ),
    })),
  };
}

function move<T>(items: readonly T[], index: number, offset: -1 | 1): T[] {
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(index + offset, 0, moved);
  return next;
}

export function moveLevel(
  draft: RubricDraft,
  index: number,
  offset: -1 | 1,
): RubricDraft {
  return {
    ...draft,
    levels: move(draft.levels, index, offset),
    criteria: draft.criteria.map((criterion) => ({
      ...criterion,
      descriptors: move(criterion.descriptors, index, offset),
    })),
  };
}

export function moveCriterion(
  draft: RubricDraft,
  index: number,
  offset: -1 | 1,
): RubricDraft {
  return { ...draft, criteria: move(draft.criteria, index, offset) };
}

export type RubricIssues = {
  general: string[];
  criteria: Record<string, string[]>;
};

const fold = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
const blank = (text: string) => !text.trim();
const multiline = (text: string) => /[\r\n]/.test(text);

export function validateRubric(draft: RubricDraft): RubricIssues {
  const general: string[] = [];
  const criteria: Record<string, string[]> = {};
  if (blank(draft.name)) general.push("Name is required.");
  else if (multiline(draft.name)) general.push("Name must be a single line.");
  if (blank(draft.description)) general.push("Description is required.");
  if (draft.levels.length < RUBRIC_LIMITS.minLevels)
    general.push(`Add at least ${RUBRIC_LIMITS.minLevels} levels.`);
  if (draft.levels.length > RUBRIC_LIMITS.levels)
    general.push(`Use at most ${RUBRIC_LIMITS.levels} levels.`);
  draft.levels.forEach((level, index) => {
    if (blank(level.label)) general.push(`Level ${index + 1} needs a name.`);
    else if (multiline(level.label))
      general.push(`Level ${index + 1} must be a single line.`);
  });
  const levels = draft.levels.map((level) => fold(level.label));
  if (levels.some((label, index) => label && levels.indexOf(label) !== index))
    general.push("Level names must be unique.");
  if (!draft.criteria.length) general.push("Add at least one criterion.");
  if (draft.criteria.length > RUBRIC_LIMITS.criteria)
    general.push(`Use at most ${RUBRIC_LIMITS.criteria} criteria.`);
  const labels = draft.criteria.map((criterion) => fold(criterion.label));
  draft.criteria.forEach((criterion, index) => {
    const found: string[] = [];
    if (blank(criterion.label)) found.push("Name is required.");
    else if (multiline(criterion.label))
      found.push("Name must be a single line.");
    else if (labels.indexOf(labels[index]) !== index)
      found.push("Another criterion has this name.");
    else if (labels[index] === fold(OVERALL))
      found.push(`"${OVERALL}" is reserved for the overall feedback.`);
    criterion.descriptors.forEach((text, position) => {
      if (blank(text))
        found.push(
          `Describe the ${draft.levels[position]?.label.trim() || `level ${position + 1}`} level.`,
        );
    });
    if (found.length) criteria[criterion.uid] = found;
  });
  if (rubricBytes(draft) > RUBRIC_LIMITS.documentBytes)
    general.push(
      `The rubric exceeds ${RUBRIC_LIMITS.documentBytes.toLocaleString()} UTF-8 bytes.`,
    );
  return { general, criteria };
}

export const hasRubricIssues = (issues: RubricIssues) =>
  issues.general.length > 0 || Object.keys(issues.criteria).length > 0;
