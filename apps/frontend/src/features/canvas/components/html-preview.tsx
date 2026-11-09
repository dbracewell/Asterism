"use client";
import { previewDocument } from "../lib/canvas";

/**
 * Renders agent- or user-written HTML in an isolated frame: an opaque origin
 * (no allow-same-origin), no popups, forms or top navigation, and a CSP that
 * blocks network access. Never inlined into the app DOM (ADR-0063).
 */
export function HtmlPreview({
  content,
  title,
}: {
  content: string;
  title: string;
}) {
  return (
    <iframe
      title={`Preview of ${title}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={previewDocument(content)}
      className="h-full min-h-64 w-full border-0"
      // The page renders with browser defaults (dark text), not app tokens,
      // so it needs the light canvas a standalone page would have.
      style={{ colorScheme: "light", backgroundColor: "white" }}
    />
  );
}
