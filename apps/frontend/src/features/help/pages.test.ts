import { describe, expect, it } from "vitest";
import { pageGuideFor, pageGuides, type PageGuideId } from "./pages";
import { helpEntries } from "./registry";

const ids = Object.keys(pageGuides) as PageGuideId[];
const none = { t: null, setting: null };

describe("page guide routes", () => {
  it.each([
    ["/", "new-chat"],
    ["/c/abc", "chat"],
    ["/c/abc/files/def", "file"],
    ["/general", "general"],
    ["/projects", "projects"],
    ["/projects/p1", "project"],
    ["/projects/p1/settings", "project-settings"],
    ["/files", "files"],
    ["/files/notes.md", "file"],
    ["/search", "search"],
    ["/settings", "settings.general"],
  ] as const)("%s → %s", (path, guide) => {
    expect(pageGuideFor(path, none, false)).toBe(guide);
  });

  it("returns null for pages without a guide", () => {
    expect(pageGuideFor("/e2e/help", none, false)).toBeNull();
  });

  it.each([
    ["general", "settings.general"],
    ["personas", "settings.personas"],
    ["skills", "settings.skills"],
    ["templates", "settings.templates"],
    ["agents", "settings.agents"],
    ["chatgpt", "settings.chatgpt"],
    ["unknown", "settings.general"],
  ] as const)("user settings %s → %s", (setting, guide) => {
    expect(pageGuideFor("/settings", { t: "user", setting }, false)).toBe(
      guide,
    );
  });

  it.each([
    [null, "admin.providers"],
    ["providers", "admin.providers"],
    ["theme_editor", "admin.theme-editor"],
    ["tools", "admin.tools"],
    ["skills", "admin.skills"],
    ["chatgpt", "admin.chatgpt"],
    ["image-captioning", "admin.image-captioning"],
    ["group-settings", "admin.overview"],
  ] as const)("admin settings %s → %s", (setting, guide) => {
    expect(pageGuideFor("/settings", { t: "admin", setting }, true)).toBe(
      guide,
    );
  });

  it("never routes non-admins to an admin guide", () => {
    for (const setting of [null, "tools", "providers", "skills"]) {
      const guide = pageGuideFor("/settings", { t: "admin", setting }, false);
      expect(guide).not.toBeNull();
      expect(pageGuides[guide!].audience).toBe("everyone");
    }
  });
});

describe("page guides", () => {
  it.each(ids)("%s has a purpose and readable areas", (id) => {
    const guide = pageGuides[id];
    expect(guide.title.trim()).not.toBe("");
    expect(guide.purpose.trim()).not.toBe("");
    for (const area of guide.areas) {
      expect(area.name.trim()).not.toBe("");
      expect(area.description.trim()).not.toBe("");
    }
  });

  it.each(ids)("%s links to existing, audience-appropriate terms", (id) => {
    const guide = pageGuides[id];
    for (const term of guide.terms) {
      expect(Object.keys(helpEntries)).toContain(term);
      if (guide.audience === "everyone")
        expect(helpEntries[term].audience).toBe("everyone");
    }
  });

  it("keeps admin guides in the admin namespace", () => {
    for (const id of ids)
      expect(pageGuides[id].audience === "admin").toBe(id.startsWith("admin."));
  });

  it("does not describe unimplemented features (ADR-0032)", () => {
    const text = ids
      .map((id) => {
        const g = pageGuides[id];
        return [
          g.title,
          g.purpose,
          ...g.areas.flatMap((a) => [a.name, a.description]),
          ...g.tasks,
        ].join(" ");
      })
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/\bmcp\b/);
    expect(text).not.toMatch(/\bremembers?\b/);
    expect(text).not.toMatch(/long-term memory/);
  });
});
