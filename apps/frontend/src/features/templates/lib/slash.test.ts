import type { PromptFramework, PromptTemplateSummary } from "@/lib/client";
import { expect, it } from "vitest";
import { slashName, templateSlashOptions } from "./slash";

const frameworks = [
  { id: "rtf", name: "RTF" },
  { id: "co-star", name: "CO-STAR" },
] as PromptFramework[];
const templates = [
  { id: "t1", name: "My Weekly Brief!" },
  { id: "t2", name: "!!!" },
] as PromptTemplateSummary[];

it("normalizes names into slash commands", () => {
  expect(slashName("My Weekly Brief!")).toBe("my-weekly-brief");
  expect(slashName("!!!")).toBe("");
});

it("matches command prefixes and name words, keeping /template first", () => {
  const labels = (search: string) =>
    templateSlashOptions(search, { frameworks, templates }).map(
      (option) => option.label,
    );
  expect(labels("")).toEqual([
    "/template",
    "/rtf",
    "/co-star",
    "/my-weekly-brief",
  ]);
  expect(labels("star")).toEqual(["/co-star"]);
  expect(labels("week")).toEqual(["/my-weekly-brief"]);
  expect(labels("temp")).toEqual(["/template"]);
  expect(labels("zzz")).toEqual([]);
  const [open, rtf, , mine] = templateSlashOptions("", {
    frameworks,
    templates,
  });
  expect(open.selection).toBeNull();
  expect(rtf.selection).toEqual({ source: "framework", id: "rtf" });
  expect(mine.selection).toEqual({ source: "template", id: "t1" });
});
