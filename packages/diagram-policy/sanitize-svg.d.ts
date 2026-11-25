export type SanitizedDiagram = {
  svg: string;
  width: number;
  height: number;
  label: string;
  description: string | null;
};

export function createDiagramSanitizer(
  createDOMPurify: (root: never) => unknown,
  window: Window & typeof globalThis,
  policy: unknown,
): (svg: string) => SanitizedDiagram | null;
