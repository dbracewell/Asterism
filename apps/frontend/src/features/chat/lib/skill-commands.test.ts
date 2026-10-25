import { describe, expect, it } from "vitest";
import { parseSkillCommands, slashSearch } from "./skill-commands";

describe("leading skill syntax", () => {
  it("preserves ordered unique commands and the remaining prompt", () => {
    expect(
      parseSkillCommands(" /review /write /review Check this /later"),
    ).toMatchObject({
      names: ["review", "write"],
      prompt: "Check this /later",
    });
    expect(parseSkillCommands("/review")).toMatchObject({
      names: ["review"],
      prompt: "",
    });
  });
  it.each([
    "https://example.com/a",
    "/usr/local/bin",
    "Look /review here",
    "`/review`",
    "```\n/review\n```",
    "a/b",
    "//comment",
  ])("keeps ordinary slash text literal: %s", (text) => {
    expect(parseSkillCommands(text).names).toEqual([]);
    expect(slashSearch(text)).toBeNull();
  });
  it.each([
    ["/", ""],
    ["/rev", "rev"],
    ["/review /wr", "wr"],
    ["/review ", null],
    ["/review Check /later", null],
  ])("offers discovery only at command boundaries: %s", (text, expected) => {
    expect(slashSearch(text!)).toBe(expected);
  });
});
