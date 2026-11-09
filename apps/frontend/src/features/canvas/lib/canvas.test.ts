import type { ToolResult } from "@/lib/client";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_CSP,
  canvasRefs,
  downloadName,
  previewDocument,
  selectionRequest,
} from "./canvas";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const result = (name: string, raw: unknown): ToolResult =>
  ({ tool_call: { function: { name } }, raw_result: raw }) as ToolResult;

describe("canvasRefs", () => {
  it("keeps first-write order and each item's last version", () => {
    expect(
      canvasRefs([
        result("canvas_create", { item_id: A, version: 1, title: "Notes" }),
        result("canvas_update", { item_id: B, version: 4, title: "Code" }),
        result("canvas_update", { item_id: A, version: 2, title: "Notes 2" }),
        result("canvas_read", { item_id: A, version: 2, title: "Notes 2" }),
        result("canvas_update", { error: "Edit 1: the text was not found" }),
        result("web_search", { item_id: B, version: 9, title: "x" }),
      ]),
    ).toEqual([
      { itemId: A, version: 2, title: "Notes 2", created: true },
      { itemId: B, version: 4, title: "Code", created: false },
    ]);
    expect(canvasRefs(null)).toEqual([]);
  });
});

describe("selectionRequest", () => {
  it("quotes the selection in a fence longer than any backticks inside it", () => {
    const text = selectionRequest({
      title: "Parser",
      itemId: A,
      version: 3,
      selection: "use ```js``` here",
      instruction: "  Make it shorter ",
    });
    expect(text.startsWith("Make it shorter\n")).toBe(true);
    expect(text).toContain(`"Parser" (id ${A}, version 3)`);
    expect(text).toContain("canvas_update");
    expect(text).toContain("````\nuse ```js``` here\n````");
  });
});

describe("previewDocument", () => {
  it("puts a network-blocking CSP before the page's own markup", () => {
    const html = previewDocument(
      "<html><head><script>1</script></head></html>",
    );
    expect(html.indexOf(PREVIEW_CSP)).toBeLessThan(html.indexOf("<script>"));
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).not.toMatch(/connect-src|https?:/);
  });
});

describe("downloadName", () => {
  it("prefers the UTF-8 name, then the plain one, then the fallback", () => {
    expect(
      downloadName(
        "attachment; filename=\"Plan_.md\"; filename*=UTF-8''Plan%20%E6%97%A5.md",
        "x",
      ),
    ).toBe("Plan 日.md");
    expect(downloadName('attachment; filename="Plan.md"', "x")).toBe("Plan.md");
    expect(downloadName(null, "canvas.md")).toBe("canvas.md");
  });
});
