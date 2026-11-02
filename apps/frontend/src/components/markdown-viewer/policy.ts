import type { UrlTransform } from "react-markdown";

// Links require a user gesture. Images and other resource URLs never pass this
// boundary, including same-origin endpoints that could carry session cookies.
export function markdownLink(url: string): string | undefined {
  if (!url || /[\u0000-\u0020\u007f\\]/.test(url)) return undefined;
  if (url.startsWith("#")) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

// ADR-0039: the only file path. An exact token reaches the renderer's link/image
// components, which never put it in `href` or `src`; near-misses stay blocked.
const FILE_TOKEN =
  /^asterism-file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function fileTokenId(url: string | null | undefined): string | null {
  return (url && FILE_TOKEN.exec(url)?.[1]) || null;
}

// ADR-0040: a claim citation is a link (never an image) whose destination is
// exactly one to four cite keys. The renderer shows the link text as the claim
// and resolves each key against the message's server-resolved citations.
const CITE_TOKEN = /^asterism-cite:([0-9a-f]{12}(?:,[0-9a-f]{12}){0,3})$/;

export function citationKeys(url: string | null | undefined): string[] | null {
  const keys = url && CITE_TOKEN.exec(url)?.[1];
  return keys ? keys.split(",") : null;
}

export const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (citationKeys(url) && key === "href" && node.tagName === "a") return url;
  if (
    fileTokenId(url) &&
    ((key === "href" && node.tagName === "a") ||
      (key === "src" && node.tagName === "img"))
  )
    return url;
  return key === "href" && node.tagName === "a" ? markdownLink(url) : undefined;
};

// KaTeX owns the generated layout markup; untrusted input cannot opt into its
// HTML, ID, link or image commands. No caller can override these settings.
export const markdownMathOptions = {
  output: "html" as const,
  trust: false,
  strict: "error" as const,
  throwOnError: false,
  maxSize: 20,
  maxExpand: 1000,
};
