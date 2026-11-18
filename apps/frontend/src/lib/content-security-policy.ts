// US-86.5: the page Content Security Policy. Scripts run only with the
// per-request nonce Next.js applies to its own tags ('strict-dynamic' lets
// those load their chunks); nothing loads from another origin.

/** The canvas HTML preview's frame document, served from `public/`. */
export const CANVAS_PREVIEW_PATH = "/canvas-preview.html";

export function pageContentSecurityPolicy({
  nonce,
  publicUrl,
  development,
}: {
  nonce: string;
  publicUrl: string;
  development: boolean;
}): string {
  const origin = new URL(publicUrl);
  const https = origin.protocol === "https:";
  // 'self' covers same-origin WebSockets in current browsers; the explicit
  // source keeps the chat stream working where it does not.
  const socket = `${https ? "wss:" : "ws:"}//${origin.host}`;
  return [
    "default-src 'self'",
    // React's development build needs eval for its debugging features.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // React and the UI libraries position elements with inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${socket}`,
    // Without this, workers fall back to script-src, where 'strict-dynamic'
    // ignores 'self' and the shared event worker would be refused.
    "worker-src 'self'",
    // Only the sandboxed canvas preview frame.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * What agent- or user-written HTML may do in the canvas preview: run inline
 * scripts and styles, use inline data, and reach no network (ADR-0063).
 */
export const PREVIEW_DOCUMENT_CSP = [
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
 * The preview frame document's header policy: the same rules, and only the
 * app may frame it. The frame is sandboxed without allow-same-origin, so its
 * origin is opaque. A `srcdoc` frame would inherit the page policy instead,
 * whose nonce rule blocks the preview's own scripts.
 */
export const CANVAS_PREVIEW_CSP = `${PREVIEW_DOCUMENT_CSP}; frame-ancestors 'self'`;

/** Headers for every Next.js response; the page CSP is added by the proxy. */
export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
];
