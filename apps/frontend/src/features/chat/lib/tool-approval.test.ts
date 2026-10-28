import { describe, expect, it } from "vitest";
import { toolRiskHint } from "./tool-approval";

describe("toolRiskHint", () => {
  it.each([
    ["write_file", "changes"],
    ["github.create-issue", "changes"],
    ["run_shell", "changes"],
    ["web_search", "reads"],
    ["read_file", "reads"],
    ["calculator", "unknown"],
    // Words inside other words do not count.
    ["spreadsheet", "unknown"],
  ])("classifies %s as %s", (name, level) => {
    expect(toolRiskHint(name).level).toBe(level);
  });

  it("prefers the cautious hint when a name both reads and changes", () => {
    expect(toolRiskHint("search_and_delete").level).toBe("changes");
  });
});
