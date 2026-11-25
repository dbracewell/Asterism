"use client";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  diagramImageSource,
  diagramStore,
  type Diagram,
  type DiagramTheme,
} from "./diagram";

const noStore = {
  subscribe: () => () => {},
  getSnapshot: () => undefined,
};

/**
 * A ` ```mermaid ` block drawn as a diagram (ADR-0081). The source is
 * untrusted; it is drawn with the fixed policy, sanitized and shown as an
 * image. Until it is drawn, or if it can't be, `fallback(note)` shows the code.
 */
export function DiagramBlock({
  source,
  closed,
  theme,
  fallback,
}: {
  source: string;
  closed: boolean;
  theme: DiagramTheme;
  fallback: (note?: string) => ReactNode;
}) {
  const drawable = closed && !!source.trim();
  const store = useMemo(
    () => (drawable ? diagramStore(source, theme) : noStore),
    [drawable, source, theme],
  );
  // The server snapshot is always undefined, so the server and the first
  // client render both show code and hydration matches.
  const diagram = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    noStore.getSnapshot,
  );
  if (!diagram) return fallback();
  if (!diagram.ok) return fallback("Couldn't draw this diagram");
  return <DrawnDiagram diagram={diagram} />;
}

function DrawnDiagram({ diagram }: { diagram: Diagram }) {
  return (
    <figure
      data-slot="diagram-block"
      className="not-prose rounded-surface border-border bg-card mb-5 max-w-full min-w-0 overflow-hidden border p-3 last:mb-0"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local data: SVG, never a remote image */}
      <img
        src={diagramImageSource(diagram.svg)}
        alt={diagram.label}
        width={diagram.width}
        height={diagram.height}
        className="mx-auto block h-auto max-w-full"
        draggable={false}
      />
      {diagram.description && (
        <figcaption className="sr-only">{diagram.description}</figcaption>
      )}
    </figure>
  );
}
