import type { Project, SkillSummary } from "@/lib/client";

export type HeroSuggestion = {
  id: string;
  label: string;
  detail: string;
  prompt: string;
};

export const MAX_SUGGESTIONS = 4;

/** The description's first sentence, without its closing punctuation. */
function firstSentence(text: string) {
  const sentence = text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return sentence.replace(/[.!?]+$/, "");
}

function projectSuggestions(project: Project): HeroSuggestion[] {
  const goal = firstSentence(project.description);
  if (!goal) return [];
  return [
    {
      id: "project:plan",
      label: "Plan the next step",
      detail: goal,
      prompt: `Outline the next steps for the ${project.name} project. Its goal: ${goal}.`,
    },
    {
      id: "project:questions",
      label: "Find open questions",
      detail: `What is still unclear in ${project.name}`,
      prompt: `What open questions should I resolve for the ${project.name} project? Its goal: ${goal}.`,
    },
  ];
}

function skillSuggestion(skill: SkillSummary): HeroSuggestion {
  return {
    id: `skill:${skill.id}`,
    label: `Use /${skill.name}`,
    detail: skill.description,
    // The trailing space completes the command, so the composer pins the skill
    // on send instead of reopening slash discovery.
    prompt: `/${skill.name} `,
  };
}

/**
 * Up to four starting prompts from data the user can already read: the
 * project's description first, then the user's eligible (assigned) skills.
 */
export function heroSuggestions({
  project,
  skills = [],
}: {
  project?: Project | null;
  skills?: SkillSummary[];
}): HeroSuggestion[] {
  return [
    ...(project ? projectSuggestions(project) : []),
    ...skills.map(skillSuggestion),
  ].slice(0, MAX_SUGGESTIONS);
}
