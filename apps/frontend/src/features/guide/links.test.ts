import { describe, expect, it } from "vitest";
import { resolveGuideHref, slugify, walkthroughHref } from "./links";

const REPO = "https://github.com/dbracewell/Asterism";

describe("resolveGuideHref (US-90.9)", () => {
  it("turns links to other guide pages into app routes, keeping anchors", () => {
    expect(
      resolveGuideHref("02-chatting/canvas.md", "attaching-files.md"),
    ).toEqual({
      kind: "internal",
      href: "/help/guide/02-chatting/attaching-files",
    });
    expect(
      resolveGuideHref(
        "02-chatting/canvas.md",
        "../08-for-administrators/policies.md#canvas",
      ),
    ).toEqual({
      kind: "internal",
      href: "/help/guide/08-for-administrators/policies#canvas",
    });
    expect(resolveGuideHref("02-chatting/canvas.md", "../README.md")).toEqual({
      kind: "internal",
      href: "/help/guide",
    });
    expect(resolveGuideHref("README.md", "glossary.md")).toEqual({
      kind: "internal",
      href: "/help/guide/glossary",
    });
  });

  it("serves screenshots from the guide's image route", () => {
    expect(
      resolveGuideHref("02-chatting/canvas.md", "../images/chat-canvas.png"),
    ).toEqual({ kind: "internal", href: "/help/guide/images/chat-canvas.png" });
  });

  it("sends links that leave the guide, and the writers' page, to the repository", () => {
    expect(
      resolveGuideHref(
        "08-for-administrators/first-time-setup.md",
        "../../deployment.md#2-configure",
      ),
    ).toEqual({
      kind: "external",
      href: `${REPO}/blob/main/docs/deployment.md#2-configure`,
    });
    expect(
      resolveGuideHref("CONTRIBUTING.md", "../../scripts/screenshots/"),
    ).toEqual({
      kind: "external",
      href: `${REPO}/tree/main/scripts/screenshots`,
    });
    expect(resolveGuideHref("README.md", "CONTRIBUTING.md")).toEqual({
      kind: "external",
      href: `${REPO}/blob/main/docs/guide/CONTRIBUTING.md`,
    });
  });

  it("leaves web links and same-page anchors alone", () => {
    expect(resolveGuideHref("README.md", "https://example.com/x")).toEqual({
      kind: "external",
      href: "https://example.com/x",
    });
    expect(resolveGuideHref("README.md", "#who-can-do-what")).toBeNull();
  });
});

it("slugs headings like GitHub", () => {
  expect(slugify("Spot the error")).toBe("spot-the-error");
  expect(slugify("**Who** can do this?")).toBe("who-can-do-this");
  expect(slugify("2. Configure")).toBe("2-configure");
});

it("routes a page guide's walkthrough", () => {
  expect(walkthroughHref("08-for-administrators/policies#export")).toBe(
    "/help/guide/08-for-administrators/policies#export",
  );
  expect(walkthroughHref("05-studying/flashcards")).toBe(
    "/help/guide/05-studying/flashcards",
  );
});
