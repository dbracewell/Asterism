import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { anchorsOf } from "../../../../../../scripts/check-docs.mjs";
import { pageGuides } from "@/features/help/pages";
import { listGuidePages, readGuideImage, readGuidePage } from "./guide-files";

vi.mock("server-only", () => ({}));

const guideRoot = path.resolve(process.cwd(), "../../docs/guide");

describe("guide files (US-90.9)", () => {
  it("lists every guide page except the writers' notes", async () => {
    const pages = await listGuidePages();
    expect(pages).toContain("README.md");
    expect(pages).toContain("02-chatting/canvas.md");
    expect(pages).not.toContain("CONTRIBUTING.md");
    expect(pages.every((page) => page.endsWith(".md"))).toBe(true);
  });

  it("reads the index and a page, and nothing outside the guide", async () => {
    expect((await readGuidePage())?.file).toBe("README.md");
    expect((await readGuidePage(["02-chatting", "canvas"]))?.markdown).toMatch(
      /^# /,
    );
    for (const slug of [["..", "deployment"], ["CONTRIBUTING"], ["missing"]])
      expect(await readGuidePage(slug)).toBeNull();
  });

  it("serves only PNG screenshots from the guide's image folder", async () => {
    expect((await readGuideImage("chat-canvas.png"))?.length).toBeGreaterThan(
      0,
    );
    for (const name of ["../README.md", "missing.png", "chat-canvas.PNG"])
      expect(await readGuideImage(name)).toBeNull();
  });
});

it("links every page guide to a guide page and heading that exist", () => {
  const pages = new Set(
    Object.values(pageGuides).map((guide) => guide.walkthrough),
  );
  expect(Object.values(pageGuides).every((guide) => guide.walkthrough)).toBe(
    true,
  );
  for (const walkthrough of pages) {
    const [page, anchor] = walkthrough!.split("#");
    const markdown = readFileSync(path.join(guideRoot, `${page}.md`), "utf8");
    if (anchor) expect(anchorsOf(markdown), walkthrough).toContain(anchor);
  }
});
