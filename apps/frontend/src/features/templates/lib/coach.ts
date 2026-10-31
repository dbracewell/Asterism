import type { CoachCriterion, PromptSuggestion } from "@/lib/client";

export const criterionLabel: Record<CoachCriterion, string> = {
  goal: "Goal",
  audience: "Audience",
  context: "Context",
  constraints: "Constraints",
  output_format: "Output format",
  examples: "Examples",
};

/**
 * The draft with one suggestion applied, or `null` when it no longer applies.
 *
 * A rewrite replaces the first exact occurrence of `find`; it cannot apply once
 * the user has edited that text away. An addition is appended as a new
 * paragraph and does not apply twice.
 */
export function applySuggestion(
  prompt: string,
  suggestion: PromptSuggestion,
): string | null {
  if (suggestion.find) {
    const index = prompt.indexOf(suggestion.find);
    if (index < 0) return null;
    return (
      prompt.slice(0, index) +
      suggestion.text +
      prompt.slice(index + suggestion.find.length)
    );
  }
  if (prompt.includes(suggestion.text)) return null;
  const base = prompt.trimEnd();
  return base ? `${base}\n\n${suggestion.text}` : suggestion.text;
}
