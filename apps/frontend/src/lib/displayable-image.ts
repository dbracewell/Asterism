import { createSvgFileSanitizer } from "@asterism/diagram-policy/sanitize-svg.js";
import createDOMPurify from "dompurify";
import { diagramPolicy } from "@/components/markdown-viewer/policy";

const SVG = "image/svg+xml";

let sanitize: ((svg: string) => string | null) | null = null;

/**
 * Bytes safe to put behind an object URL for an `<img>` (US-116.2). A blob URL
 * opened in its own tab runs with the app's origin, so an uploaded or produced
 * SVG is cleaned first: no scripts, event attributes, foreign HTML, links or
 * stylesheets out of the document. Raster images pass through unchanged.
 * Returns null for an SVG with nothing drawable left.
 */
export async function displayableImage(
  data: Blob,
  type: string,
): Promise<Blob | null> {
  if (type !== SVG) return new Blob([data], { type });
  sanitize ??= createSvgFileSanitizer(createDOMPurify, window, diagramPolicy);
  const clean = sanitize(await data.text());
  return clean === null ? null : new Blob([clean], { type: SVG });
}
