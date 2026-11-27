import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";

// public/canvas-preview.html's script, run with a fake window (US-117.2).
const page = readFileSync(
  path.resolve(__dirname, "../../../../public/canvas-preview.html"),
  "utf8",
);
const script = /<script>([\s\S]*?)<\/script>/.exec(page)![1];

it("keeps listening until the app's page arrives, then shows it once", () => {
  const listeners = new Set<(event: object) => void>();
  const parent = {};
  const document = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
  new Function(
    "addEventListener",
    "removeEventListener",
    "parent",
    "document",
    script,
  )(
    (_type: string, listener: (event: object) => void) =>
      listeners.add(listener),
    (_type: string, listener: (event: object) => void) =>
      listeners.delete(listener),
    parent,
    document,
  );
  const send = (event: object) =>
    [...listeners].forEach((listener) => listener(event));

  send({ source: {}, data: { asterismCanvasPreview: "<p>other window</p>" } });
  send({ source: parent, data: "not a page" });
  send({ source: parent, data: { asterismCanvasPreview: 42 } });
  expect(document.write).not.toHaveBeenCalled();
  expect(listeners.size).toBe(1);

  send({ source: parent, data: { asterismCanvasPreview: "<p>page</p>" } });
  send({ source: parent, data: { asterismCanvasPreview: "<p>again</p>" } });
  expect(document.write).toHaveBeenCalledTimes(1);
  expect(document.write).toHaveBeenCalledWith("<p>page</p>");
  expect(listeners.size).toBe(0);
});
