import type { VerifiedClaim } from "@/lib/client";

export type ClaimLabel = VerifiedClaim["label"];

/**
 * Ranges in `root`'s rendered text that spell `quote`, ignoring differences in
 * whitespace. The quote may span inline formatting (several text nodes).
 * Returns at most one range: the first occurrence.
 */
export function findQuoteRange(root: Node, quote: string): Range | null {
  const target = quote.replace(/\s+/g, " ").trim();
  if (!target) return null;
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // Collapsed text and, for each of its characters, the node and offset it came from.
  let text = "";
  const origins: { node: Text; offset: number }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data;
    for (let offset = 0; offset < value.length; offset++) {
      const char = /\s/.test(value[offset]) ? " " : value[offset];
      if (char === " " && (text.endsWith(" ") || !text)) continue;
      text += char;
      origins.push({ node: node as Text, offset });
    }
  }
  const start = text.indexOf(target);
  if (start < 0) return null;
  const first = origins[start];
  const last = origins[start + target.length - 1];
  const range = doc.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

export const HIGHLIGHT_LABELS = [
  "supported",
  "unsupported",
  "contradicted",
] as const satisfies readonly ClaimLabel[];

type Registered = Map<string, Map<ClaimLabel, Range[]>>;
const registered: Registered = new Map();

const supported = () =>
  typeof CSS !== "undefined" &&
  "highlights" in CSS &&
  typeof Highlight !== "undefined";

/*
 * Highlight styles. They are installed at runtime because the CSS bundler does
 * not parse `::highlight()`. Visual only: every label is also listed as text.
 */
const STYLES = `
::highlight(claim-supported) {
  text-decoration: underline solid var(--color-primary) 2px;
}
::highlight(claim-unsupported) {
  text-decoration: underline dotted var(--color-muted-foreground) 2px;
}
::highlight(claim-contradicted) {
  background-color: color-mix(in srgb, var(--color-destructive) 18%, transparent);
  text-decoration: underline wavy var(--color-destructive);
}`;
let styled = false;

function installStyles() {
  if (styled) return;
  styled = true;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLES);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

function publish() {
  if (!supported()) return;
  installStyles();
  for (const label of HIGHLIGHT_LABELS) {
    const ranges = [...registered.values()].flatMap(
      (byLabel) => byLabel.get(label) ?? [],
    );
    const name = `claim-${label}`;
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
    else CSS.highlights.delete(name);
  }
}

/**
 * Show one message's claim ranges. Highlights are visual only: they do not
 * change the rendered Markdown, and the claim list carries the same labels as
 * text. Returns a function that removes them.
 */
export function showClaimHighlights(
  owner: string,
  ranges: { label: ClaimLabel; range: Range }[],
): () => void {
  const byLabel = new Map<ClaimLabel, Range[]>();
  for (const { label, range } of ranges)
    byLabel.set(label, [...(byLabel.get(label) ?? []), range]);
  registered.set(owner, byLabel);
  publish();
  return () => {
    registered.delete(owner);
    publish();
  };
}
