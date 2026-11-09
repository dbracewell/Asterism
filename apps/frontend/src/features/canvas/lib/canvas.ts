import type { ToolResult } from "@/lib/client";
import { z } from "zod";

/** The main agent's canvas tools (ADR-0063). */
export const CANVAS_CREATE = "canvas_create";
export const CANVAS_UPDATE = "canvas_update";
export const CANVAS_READ = "canvas_read";
const WRITERS = new Set([CANVAS_CREATE, CANVAS_UPDATE]);

const written = z.object({
  item_id: z.uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1),
});

/** A canvas version a message produced: what its card links to. */
export type CanvasRef = {
  itemId: string;
  version: number;
  title: string;
  /** The message created the item, rather than only updating it. */
  created: boolean;
};

/**
 * The canvas items a message wrote, in first-write order, each at the last
 * version the message produced. Tool results carry ids, never the content.
 */
export function canvasRefs(
  results: ToolResult[] | null | undefined,
): CanvasRef[] {
  const refs = new Map<string, CanvasRef>();
  for (const result of results ?? []) {
    const name = result.tool_call.function.name;
    if (!WRITERS.has(name)) continue;
    const parsed = written.safeParse(result.raw_result);
    if (!parsed.success) continue;
    const { item_id: itemId, version, title } = parsed.data;
    const created = name === CANVAS_CREATE || !!refs.get(itemId)?.created;
    refs.set(itemId, { itemId, version, title, created });
  }
  return [...refs.values()];
}

const fenceFor = (text: string) => {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  return "`".repeat(Math.max(3, longest + 1));
};

/** The chat message "ask about selection" sends: a targeted canvas request. */
export function selectionRequest({
  title,
  itemId,
  version,
  selection,
  instruction,
}: {
  title: string;
  itemId: string;
  version: number;
  selection: string;
  instruction: string;
}): string {
  const fence = fenceFor(selection);
  return [
    instruction.trim(),
    "",
    `This is about the selected text in the canvas item "${title}" (id ${itemId}, version ${version}). Change only this part, with canvas_update edits:`,
    "",
    fence,
    selection,
    fence,
  ].join("\n");
}

/** The longest selection "ask about selection" quotes. */
export const MAX_SELECTION_LENGTH = 4000;

/**
 * Blocks every fetch, form and frame; inline script and style still run, so
 * pages work offline. The iframe sandbox (no allow-same-origin, popups or top
 * navigation) keeps the page away from the app.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * The document an HTML preview frame renders: the CSP comes first, so it
 * applies before any of the page's own markup. Links target a new window,
 * which the sandbox refuses.
 */
export function previewDocument(content: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><base target="_blank">${content}`;
}

export type CanvasKindName = "document" | "code" | "html";

export function kindLabel(kind: CanvasKindName, language: string): string {
  if (kind === "code") return language || "Code";
  return kind === "html" ? "HTML page" : "Document";
}
