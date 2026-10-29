import type { Project, SkillSummary } from "@/lib/client";
import { describe, expect, it } from "vitest";
import { heroSuggestions } from "./hero-suggestions";

const project = (description: string): Project => ({
  id: "p",
  name: "Atlas",
  description,
  system_prompt: "",
  context_revision: 1,
  created_at: 0,
  updated_at: 0,
});
const skill = (name: string): SkillSummary => ({
  id: name,
  name,
  description: `${name} description`,
  revision: 1,
  created_at: 0,
  updated_at: 0,
});

describe("heroSuggestions", () => {
  it("derives project prompts from the description's first sentence", () => {
    const suggestions = heroSuggestions({
      project: project("Map the coastline. Then publish it."),
    });
    expect(suggestions.map((item) => item.id)).toEqual([
      "project:plan",
      "project:questions",
    ]);
    expect(suggestions[0].prompt).toBe(
      "Outline the next steps for the Atlas project. Its goal: Map the coastline.",
    );
  });

  it("offers nothing for a project without a description or skills", () => {
    expect(heroSuggestions({ project: project("  ") })).toEqual([]);
    expect(heroSuggestions({})).toEqual([]);
  });

  it("completes skill commands and caps the list at four", () => {
    const suggestions = heroSuggestions({
      project: project("Map the coastline"),
      skills: ["a", "b", "c"].map(skill),
    });
    expect(suggestions).toHaveLength(4);
    expect(suggestions[2]).toMatchObject({
      label: "Use /a",
      detail: "a description",
      prompt: "/a ",
    });
  });
});
