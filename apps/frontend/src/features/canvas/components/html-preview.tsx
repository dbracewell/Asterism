"use client";
import { CANVAS_PREVIEW_PATH } from "@/lib/content-security-policy";
import { previewDocument } from "../lib/canvas";

/**
 * Renders agent- or user-written HTML in an isolated frame: an opaque origin
 * (no allow-same-origin), no popups, forms or top navigation, and a CSP that
 * blocks network access. Never inlined into the app DOM (ADR-0063).
 *
 * The frame loads its own document with its own policy and receives the page
 * once it has loaded (US-86.5); a `srcdoc` frame would inherit the app's CSP,
 * which refuses the preview's inline scripts. Each content change remounts
 * the frame, so a page cannot keep state or listeners across versions.
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
      key={content}
      title={`Preview of ${title}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      // The load listener goes on before the frame loads: set during server
      // rendering, the frame could load before hydration and miss the page.
      ref={(frame) => {
        if (!frame) return;
        const post = () =>
          // The frame's origin is opaque, so no narrower target origin exists.
          frame.contentWindow?.postMessage(
            { asterismCanvasPreview: previewDocument(content) },
            "*",
          );
        frame.addEventListener("load", post);
        frame.src = CANVAS_PREVIEW_PATH;
        return () => frame.removeEventListener("load", post);
      }}
      className="h-full min-h-64 w-full border-0"
      // The page renders with browser defaults (dark text), not app tokens,
      // so it needs the light canvas a standalone page would have.
      style={{ colorScheme: "light", backgroundColor: "white" }}
    />
  );
}
