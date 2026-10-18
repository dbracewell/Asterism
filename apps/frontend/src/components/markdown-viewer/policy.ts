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

export const markdownUrlTransform: UrlTransform = (url, key, node) =>
  key === "href" && node.tagName === "a" ? markdownLink(url) : undefined;

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
