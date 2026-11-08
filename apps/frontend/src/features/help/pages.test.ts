import { readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { getLazyAdminSettingsSections } from "@/features/settings/ui/admin-settings/lazy-sections";
import type { Types } from "@/features/settings/types";
import { UserSettings } from "@/features/settings/ui/user-settings";
import { pageGuideFor, pageGuides, type PageGuideId } from "./pages";
import { helpEntries } from "./registry";

const ids = Object.keys(pageGuides) as PageGuideId[];
const none = { t: null, setting: null };

/** Each app route, as its folder path under app/(main), and its guide. */
const ROUTE_GUIDES: Record<string, PageGuideId> = {
  "/": "new-chat",
  "/c/[chatId]": "chat",
  "/c/[chatId]/files/[fileId]": "file",
  "/general": "general",
  "/projects": "projects",
  "/projects/[projectId]": "project",
  "/projects/[projectId]/study/[deckId]": "study.deck",
  "/projects/[projectId]/study/[deckId]/drafts": "study.drafts",
  "/projects/[projectId]/study/[deckId]/review": "study.review",
  "/projects/[projectId]/study/quizzes/new": "study.quiz-new",
  "/projects/[projectId]/study/quizzes/[quizId]": "study.quiz",
  "/projects/[projectId]/study/quizzes/[quizId]/take": "study.quiz-take",
  "/projects/[projectId]/study/quizzes/[quizId]/attempts/[attemptId]":
    "study.quiz-attempt",
  "/projects/[projectId]/study/summaries/new": "study.summary-new",
  "/projects/[projectId]/study/guides/new": "study.guide-new",
  "/projects/[projectId]/study/notes/[noteId]": "study.note",
  "/classes": "classes",
  "/classes/[classId]": "class",
  "/team-packs": "team-packs",
  "/files": "files",
  "/files/[filename]": "file",
  "/search": "search",
  "/help": "help",
  "/settings": "settings.general",
};

/** Every page.tsx under app/(main), as a route path. */
function appRoutes(): string[] {
  // Tests run from apps/frontend.
  const root = join(process.cwd(), "src", "app", "(main)");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file === "page.tsx" || file.endsWith(`${sep}page.tsx`))
    .map((file) =>
      `/${dirname(file).split(sep).join("/")}`.replace(/\/\.$/, "/"),
    )
    .map((route) => (route === "/." ? "/" : route));
}

/** A concrete URL for a route: each [param] becomes a sample value. */
const sample = (route: string) => route.replace(/\[[^\]]+\]/g, "x1");

const sections = (settings: Types) =>
  settings.flatMap((item) => (item.type === "section" ? [item] : []));

describe("page guide coverage", () => {
  it("names a guide for every app route, so new pages must add one", () => {
    expect(appRoutes().sort()).toEqual(Object.keys(ROUTE_GUIDES).sort());
  });

  it.each(Object.entries(ROUTE_GUIDES))("%s → %s", (route, guide) => {
    expect(pageGuideFor(sample(route), none, false)).toBe(guide);
  });

  it("gives every working settings section its own guide", () => {
    const shared = new Map<PageGuideId, string>();
    const check = (t: string, settings: Types, isAdmin: boolean) => {
      for (const section of sections(settings)) {
        const guide = pageGuideFor(
          "/settings",
          { t, setting: section.value },
          isAdmin,
        );
        // Planned sections get no help until they ship (ADR-0032).
        if (section.badge === "Planned") {
          expect(guide, section.value).toBeNull();
          continue;
        }
        expect(guide, section.value).not.toBeNull();
        // No section borrows another section's guide.
        expect(shared.get(guide!), section.value).toBeUndefined();
        shared.set(guide!, section.value);
      }
    };
    check("user", UserSettings, false);
    check("admin", getLazyAdminSettingsSections(), true);
  });

  it("reaches every guide from some page or section", () => {
    const reached = new Set<PageGuideId | null>([
      ...Object.values(ROUTE_GUIDES),
      ...sections(UserSettings).map((section) =>
        pageGuideFor("/settings", { t: "user", setting: section.value }, false),
      ),
      ...sections(getLazyAdminSettingsSections()).map((section) =>
        pageGuideFor("/settings", { t: "admin", setting: section.value }, true),
      ),
    ]);
    expect(ids.filter((id) => !reached.has(id))).toEqual([]);
  });

  it("returns null outside the app, such as test harness pages", () => {
    expect(pageGuideFor("/e2e/help", none, false)).toBeNull();
  });

  it("matches a study path with a trailing slash", () => {
    expect(pageGuideFor("/projects/p/study/quizzes/q/take/", none, false)).toBe(
      "study.quiz-take",
    );
  });

  it("falls back to each tab's default section, as the settings page does", () => {
    expect(
      pageGuideFor("/settings", { t: "user", setting: "unknown" }, false),
    ).toBe("settings.general");
    expect(
      pageGuideFor("/settings", { t: "user", setting: "constructor" }, false),
    ).toBe("settings.general");
    expect(pageGuideFor("/settings", { t: "admin", setting: null }, true)).toBe(
      "admin.providers",
    );
    expect(
      pageGuideFor("/settings", { t: "admin", setting: "unknown" }, true),
    ).toBe("admin.providers");
    expect(
      pageGuideFor("/settings", { t: "admin", setting: "toString" }, true),
    ).toBe("admin.providers");
  });

  it("never routes non-admins to an admin guide", () => {
    for (const setting of [null, "tools", "providers", "skills", "export"]) {
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

// US-66.3: help matches the tabbed project workspace (EPIC-65).
describe("help after the project workspace redesign", () => {
  const allText = [
    ...Object.values(helpEntries).flatMap((entry) => [
      entry.summary,
      ...entry.details,
    ]),
    ...ids.flatMap((id) => {
      const guide = pageGuides[id];
      return [
        guide.purpose,
        ...guide.areas.map((area) => area.description),
        ...guide.tasks,
      ];
    }),
  ];

  it("never places sub-agent selection in project settings", () => {
    for (const text of allText) {
      expect(text).not.toMatch(/project'?s? settings[^.]*sub-agent/i);
    }
  });

  it("names the project tab instead of a generic project page", () => {
    for (const text of allText) {
      expect(text).not.toMatch(/(listed|shows?) on the project page/i);
      expect(text).not.toMatch(/the project page then/i);
    }
  });
});
