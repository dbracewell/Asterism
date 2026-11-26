export type PreparedDiagram = {
  /** The source with accessibility statements where mermaid accepts them. */
  source: string;
  /** The first `accTitle`, if any. */
  title: string | null;
  /** The first `accDescr` (single line or block), if any. */
  description: string | null;
};

export function prepareDiagramSource(source: string): PreparedDiagram;
