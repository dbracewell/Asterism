import {
  createDiagramSanitizer,
  type SanitizedDiagram,
} from "@asterism/diagram-policy/sanitize-svg.js";
import createDOMPurify from "dompurify";
import type { DiagramTheme } from "./diagram-theme";
import {
  diagramPolicy,
  markdownMermaidConfig,
  MERMAID_RENDER_TIMEOUT_MS,
} from "./policy";

export type { DiagramTheme } from "./diagram-theme";

export type Diagram = {
  ok: true;
  /** Sanitized, standalone SVG markup, safe to show as an image. */
  svg: string;
  width: number;
  height: number;
  /** The diagram's accessible name: its `accTitle`, or "Diagram: <type>". */
  label: string;
  /** The diagram's `accDescr`, when it has one. */
  description: string | null;
};

export type DiagramResult = Diagram | { ok: false };

const FAILED: DiagramResult = Object.freeze({ ok: false });

// A fence is drawn only once it is closed, so a streaming diagram stays code
// until it is complete. `raw` is the block's source span, fences included; a
// fence inside a blockquote or list keeps its `>` or indent.
export function isClosedFence(raw: string): boolean {
  const lines = raw.replace(/\n+$/, "").split("\n");
  if (lines.length < 2) return false;
  const open = /^[\s>]*(`{3,}|~{3,})/.exec(lines[0])?.[1];
  const close = /^[\s>]*(`{3,}|~{3,})\s*$/.exec(lines.at(-1)!)?.[1];
  return (
    !!open && !!close && close[0] === open[0] && close.length >= open.length
  );
}

// The shared sanitizer (ADR-0082): the server's export renderer runs the same
// file, so the app and exports clean diagrams identically.
let sanitize: ((svg: string) => SanitizedDiagram | null) | null = null;

/**
 * Keeps only static SVG: no scripts, event attributes, foreign HTML, embedded
 * images or links out of the document. Returns standalone markup with an
 * explicit size, or null when nothing drawable is left.
 */
export function sanitizeDiagramSvg(svg: string): Omit<Diagram, "ok"> | null {
  sanitize ??= createDiagramSanitizer(createDOMPurify, window, diagramPolicy);
  return sanitize(svg);
}

export const diagramImageSource = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

type Mermaid = typeof import("mermaid").default;
let mermaidModule: Promise<Mermaid> | null = null;
const loadMermaid = () =>
  (mermaidModule ??= import("mermaid").then((module) => module.default));

const timeout = (ms: number) =>
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Diagram timed out")), ms),
  );

// mermaid.initialize is global, so renders run one at a time, each with its
// own theme.
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

async function draw(source: string, theme: DiagramTheme) {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    ...markdownMermaidConfig,
    secure: [...markdownMermaidConfig.secure],
    flowchart: { ...markdownMermaidConfig.flowchart },
    state: { ...markdownMermaidConfig.state },
    ...(theme.variables
      ? { theme: "base" as const, themeVariables: theme.variables }
      : { theme: theme.dark ? ("dark" as const) : ("default" as const) }),
  });
  const { svg } = await mermaid.render(
    `asterism-diagram-${++sequence}`,
    source,
  );
  return svg;
}

/** Draws untrusted mermaid source. Never rejects: failures come back as `{ok: false}`. */
export function renderDiagram(
  source: string,
  theme: DiagramTheme,
): Promise<DiagramResult> {
  const run = queue.then(() =>
    Promise.race([draw(source, theme), timeout(MERMAID_RENDER_TIMEOUT_MS)]),
  );
  queue = run.catch(() => undefined);
  return run.then(
    (svg) => {
      const diagram = sanitizeDiagramSvg(svg);
      return diagram ? { ok: true as const, ...diagram } : FAILED;
    },
    () => FAILED,
  );
}

// One store per theme and source, so re-rendering a message (or the same
// diagram in another view) never draws it again. Subscribing starts the draw;
// the snapshot is undefined until it finishes. Bounded, oldest first.
export type DiagramStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => DiagramResult | undefined;
};

const CACHE_LIMIT = 100;
const stores = new Map<string, DiagramStore>();

function createStore(source: string, theme: DiagramTheme): DiagramStore {
  let result: DiagramResult | undefined;
  let started = false;
  const listeners = new Set<() => void>();
  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (!started) {
        started = true;
        void renderDiagram(source, theme).then((value) => {
          result = value;
          listeners.forEach((listener) => listener());
        });
      }
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => result,
  };
}

export function diagramStore(
  source: string,
  theme: DiagramTheme,
): DiagramStore {
  const key = `${theme.key}\n${source}`;
  let store = stores.get(key);
  if (store) {
    stores.delete(key);
  } else {
    store = createStore(source, theme);
    if (stores.size >= CACHE_LIMIT) stores.delete(stores.keys().next().value!);
  }
  stores.set(key, store);
  return store;
}

export function clearDiagramCacheForTests() {
  stores.clear();
}

/** A download name from the diagram's label: "Water cycle" → "water-cycle". */
export function diagramFileName(label: string, extension: "svg" | "png") {
  const base = label
    .replace(/^Diagram: /, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${base || "diagram"}.${extension}`;
}

export const diagramSvgBlob = (diagram: Diagram) =>
  new Blob([diagram.svg], { type: "image/svg+xml;charset=utf-8" });

/** The largest PNG side, so a huge diagram can't exhaust canvas memory. */
const PNG_MAX_SIDE = diagramPolicy.png.maxSide;

/**
 * The sanitized SVG drawn at twice its size on `background`. Made in the
 * browser from the same image the page shows; nothing is uploaded.
 */
export async function diagramPngBlob(
  diagram: Diagram,
  background: string,
): Promise<Blob> {
  const image = new Image();
  image.src = diagramImageSource(diagram.svg);
  await image.decode();
  const scale = Math.min(
    diagramPolicy.png.scale,
    PNG_MAX_SIDE / diagram.width,
    PNG_MAX_SIDE / diagram.height,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(diagram.width * scale);
  canvas.height = Math.round(diagram.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG failed"))),
      "image/png",
    ),
  );
}
