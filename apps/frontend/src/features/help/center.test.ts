import { describe, expect, it } from "vitest";
import {
  helpAnchor,
  helpCenterHref,
  pageGuideAnchor,
  pageGuideHref,
  searchHelp,
} from "./center";
import { pageGuides, type PageGuideId } from "./pages";
import { helpEntries, type HelpId } from "./registry";

const helpIds = Object.keys(helpEntries) as HelpId[];
const guideIds = Object.keys(pageGuides) as PageGuideId[];

describe("help center anchors", () => {
  it("gives every entry and guide a unique anchor", () => {
    const anchors = [
      ...helpIds.map(helpAnchor),
      ...guideIds.map(pageGuideAnchor),
    ];
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("links into the help center page", () => {
    expect(helpCenterHref("concept.persona")).toBe("/help#concept.persona");
    expect(pageGuideHref("admin.tools")).toBe("/help#page-admin.tools");
  });
});

describe("searchHelp", () => {
  const all = (query: string, isAdmin: boolean) => {
    const results = searchHelp(query, isAdmin);
    return [
      ...results.concepts.map(([id]) => id),
      ...results.controls.map(([id]) => id),
      ...results.guides.map(([id]) => `page-${id}`),
    ];
  };

  it("lists everything an admin may see when the query is empty", () => {
    expect(all("", true)).toHaveLength(helpIds.length + guideIds.length);
  });

  it("hides admin-only entries and guides from other users", () => {
    const visible = all("", false);
    for (const id of helpIds) {
      expect(visible.includes(id)).toBe(
        helpEntries[id].audience === "everyone",
      );
    }
    for (const id of guideIds) {
      expect(visible.includes(`page-${id}`)).toBe(
        pageGuides[id].audience === "everyone",
      );
    }
    expect(all("tool policy", false)).not.toContain("admin.tools");
    expect(all("tool policy", true)).toContain("admin.tools");
  });

  it("splits glossary concepts from control help and sorts entries by title", () => {
    const { concepts, controls } = searchHelp("", true);
    expect(concepts.every(([id]) => id.startsWith("concept."))).toBe(true);
    expect(controls.some(([id]) => id.startsWith("concept."))).toBe(false);
    const titles = concepts.map(([, entry]) => entry.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it("matches every word, case-insensitively, across the details", () => {
    expect(all("PERSONA", false)).toContain("concept.persona");
    // Only in the persona's details.
    expect(all("isn't a memory", false)).toContain("concept.persona");
    expect(all("persona zzzz", false)).toEqual([]);
  });

  it("finds page guides by their areas and tips", () => {
    expect(all("paperclip", false)).toContain("page-new-chat");
  });
});
