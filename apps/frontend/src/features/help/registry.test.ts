import { describe, expect, it } from "vitest";
import { helpEntries, isVisibleTo, type HelpId } from "./registry";

const ids = Object.keys(helpEntries) as HelpId[];

// US-61.1 acceptance: the glossary covers the composer and learner concepts.
const requiredGlossary: HelpId[] = [
  "concept.chat",
  "concept.general-chat",
  "concept.project",
  "concept.persona",
  "concept.main-agent",
  "concept.sub-agent",
  "concept.skill",
  "concept.learning-mode",
  "concept.mode-standard",
  "concept.mode-tutor",
  "concept.mode-explain-back",
  "concept.mode-review",
  "concept.hint-levels",
  "concept.answer-reveal",
  "concept.mode-lock",
  "concept.template",
  "concept.model",
  "concept.attachment",
  "concept.file-scope",
  "concept.comparison",
  "concept.tool-approval",
  "concept.citation",
];

// US-66.2: entries for study tools, reflections, classes and packs.
const newerGlossary: HelpId[] = [
  "concept.class",
  "concept.educator",
  "concept.course",
  "concept.class-code",
  "concept.class-invite",
  "concept.class-mode-policy",
  "concept.class-insights",
  "concept.flashcard",
  "concept.quiz",
  "concept.weak-spot",
  "concept.topic-mastery",
  "concept.reflection",
  "concept.study-note",
  "concept.team-pack",
  "admin.settings-file",
];

const text = (id: HelpId) => {
  const entry = helpEntries[id];
  return [entry.title, entry.summary, ...entry.details].join(" ");
};

describe("help registry", () => {
  it("covers every required glossary concept", () => {
    for (const id of [...requiredGlossary, ...newerGlossary]) {
      expect(ids).toContain(id);
    }
  });

  it("states the limits learners rely on (US-66.2)", () => {
    // Insights are thresholded totals, and sharing starts off.
    expect(text("concept.class-insights")).toMatch(/at least five students/);
    expect(text("concept.class-insights")).toMatch(/off until/);
    expect(text("concept.class-insights")).toMatch(
      /never see chats, answers or any one student's results/,
    );
    // The class policy only narrows what students can do.
    expect(text("concept.class-mode-policy")).toMatch(/can only limit/);
    // Packs never carry secrets or grant tools on their own.
    expect(text("concept.team-pack")).toMatch(/never holds files, keys/);
    expect(text("concept.team-pack")).toMatch(/can't grant tools/);
    // Educators are not administrators.
    expect(text("concept.educator")).toMatch(/not administrators/);
  });

  it("keeps the settings file admin-only", () => {
    expect(helpEntries["admin.settings-file"].audience).toBe("admin");
    for (const id of newerGlossary) {
      if (id === "admin.settings-file") continue;
      expect(helpEntries[id].audience, id).toBe("everyone");
    }
  });

  it.each(ids)("%s has readable, non-empty content", (id) => {
    const entry = helpEntries[id];
    expect(entry.title.trim()).not.toBe("");
    expect(entry.summary.trim()).not.toBe("");
    // The summary is shown first; keep it short.
    expect(entry.summary.length).toBeLessThanOrEqual(200);
    for (const paragraph of entry.details) {
      expect(paragraph.trim()).not.toBe("");
    }
  });

  it.each(ids)("%s links only to other, existing entries", (id) => {
    const related = helpEntries[id].related;
    expect(related).not.toContain(id);
    expect(new Set(related).size).toBe(related.length);
    for (const relatedId of related) expect(ids).toContain(relatedId);
  });

  it("keeps everyone-facing entries free of admin-only links", () => {
    for (const id of ids) {
      const entry = helpEntries[id];
      if (entry.audience !== "everyone") continue;
      for (const relatedId of entry.related) {
        expect(helpEntries[relatedId].audience, `${id} → ${relatedId}`).toBe(
          "everyone",
        );
      }
    }
  });

  it("puts admin entries in the admin namespace only", () => {
    for (const id of ids) {
      expect(helpEntries[id].audience === "admin").toBe(
        id.startsWith("admin."),
      );
    }
  });

  it("hides admin entries from non-admins", () => {
    expect(isVisibleTo(helpEntries["admin.tools"], false)).toBe(false);
    expect(isVisibleTo(helpEntries["admin.tools"], true)).toBe(true);
    expect(isVisibleTo(helpEntries["concept.persona"], false)).toBe(true);
  });

  it("does not describe unimplemented features or grants (ADR-0032)", () => {
    const text = ids
      .map((id) => {
        const entry = helpEntries[id];
        return [entry.title, entry.summary, ...entry.details].join(" ");
      })
      .join(" ")
      .toLowerCase();
    // MCP servers have no UI yet; there is no long-term memory engine.
    expect(text).not.toMatch(/\bmcp\b/);
    expect(text).not.toMatch(/\bremembers?\b/);
    expect(text).not.toMatch(/long-term memory/);
    // Prompt-layer features never grant tools or files.
    expect(text).not.toMatch(
      /(persona|skill|template|mode)s? (gives?|grants?)/,
    );
  });
});
