import { describe, expect, it } from "vitest";
import { helpEntries, isVisibleTo, type HelpId } from "./registry";

const user = { isAdmin: false, has: () => true };
const admin = { isAdmin: true, has: () => true };

const ids = Object.keys(helpEntries) as HelpId[];

// US-61.1 acceptance: the glossary covers the composer and learner concepts.
const requiredGlossary: HelpId[] = [
  "concept.chat",
  "concept.general-chat",
  "concept.project",
  "concept.about-you",
  "concept.main-agent",
  "concept.sub-agent",
  "concept.skill",
  "concept.learning-mode",
  "concept.mode-standard",
  "concept.mode-tutor",
  "concept.mode-explain-back",
  "concept.mode-review",
  "concept.mode-spot-the-error",
  "concept.hint-levels",
  "concept.answer-reveal",
  "concept.mode-policy",
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
  "concept.class-insights",
  "concept.flashcard",
  "concept.quiz",
  "concept.progress",
  "concept.reflection",
  "concept.study-note",
  "concept.team-pack",
  "admin.settings-file",
  // US-86.8: limits, account lifecycle and personal data.
  "concept.usage-limit",
  "concept.suspension",
  "concept.deletion-request",
  "concept.data-download",
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
    // The course policy only narrows, and unlocking never lifts it (ADR-0068).
    expect(text("concept.mode-policy")).toMatch(/can only limit/);
    expect(text("concept.mode-policy")).toMatch(/stricter rule wins/);
    expect(text("concept.mode-policy")).toMatch(/never the course's limits/);
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
    expect(isVisibleTo(helpEntries["admin.tools"], user)).toBe(false);
    expect(isVisibleTo(helpEntries["admin.tools"], admin)).toBe(true);
    expect(isVisibleTo(helpEntries["concept.about-you"], user)).toBe(true);
  });

  it("hides help about a feature that is off for the viewer, admins too (EPIC-97)", () => {
    const off = (isAdmin: boolean) => ({
      isAdmin,
      has: (feature: string) => feature !== "memory",
    });
    expect(isVisibleTo(helpEntries["concept.memory"], off(false))).toBe(false);
    expect(isVisibleTo(helpEntries["concept.memory"], off(true))).toBe(false);
    expect(isVisibleTo(helpEntries["concept.memory"], user)).toBe(true);
    // EPIC-98: decks and quizzes from chat follow their own setting.
    const noStudyChat = {
      isAdmin: false,
      has: (f: string) => f !== "study_chat",
    };
    expect(isVisibleTo(helpEntries["concept.study-chat"], noStudyChat)).toBe(
      false,
    );
    expect(isVisibleTo(helpEntries["concept.study-chat"], user)).toBe(true);
    // Admin help for the policy itself stays.
    expect(isVisibleTo(helpEntries["admin.tools"], off(true))).toBe(true);
  });

  it("does not describe unimplemented features or grants (ADR-0032)", () => {
    const text = ids
      .map((id) => {
        const entry = helpEntries[id];
        return [entry.title, entry.summary, ...entry.details].join(" ");
      })
      .join(" ")
      .toLowerCase();
    // MCP servers have no UI yet. (Memory shipped with EPIC-93, so it may be described.)
    expect(text).not.toMatch(/\bmcp\b/);
    // Prompt-layer features never grant tools or files.
    expect(text).not.toMatch(
      /(about you|persona|skill|template|mode)s? (gives?|grants?)/,
    );
  });
});
