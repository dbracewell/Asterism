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
): (
  svg: string,
  names?: { title?: string | null; description?: string | null },
) => SanitizedDiagram | null;

export function withoutExternalCss(css: string): string;

export function createSvgFileSanitizer(
  createDOMPurify: (root: never) => unknown,
  window: Window & typeof globalThis,
  policy: unknown,
): (svg: string) => string | null;
