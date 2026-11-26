# @asterism/diagram-policy

The one copy of how Asterism draws mermaid diagrams from untrusted text:

- `mermaid`: the locked configuration passed to `mermaid.initialize`. Its
  `secure` list stops `%%{init}%%` directives and frontmatter from changing
  security, theme, font, CSS or label settings.
- `sanitizer`: the DOMPurify settings for the drawn SVG. `href` is kept only
  when it starts with `internalHrefPrefix`.
- `renderTimeoutMs`, `png` and `labelLimits`: time, size and name limits.
- `sanitize-svg.js`: `createDiagramSanitizer(createDOMPurify, window, policy)`,
  the one function that cleans a drawn SVG and reads its size, name and
  description (falling back to the names `prepareDiagramSource` found). Plain JavaScript with no imports, so the server can load it into
  its headless page unbundled.
- `diagram-source.js`: `prepareDiagramSource(source)`, run before drawing.
  It moves `accTitle`/`accDescr` lines that a model put above the diagram type
  to just below it, drops them from diagram types that refuse them (mind
  maps), and returns the title and description for the sanitizer to name the
  picture (EPIC-108). It changes nothing else.
- `print-theme.json`: mermaid `base` theme variables for exported documents,
  from the light Atlas palette. It is generated from the app's
  `diagramThemeVariables`; a frontend test fails when they differ.

The app's markdown viewer (`apps/frontend/src/components/markdown-viewer`) and
the server's export renderer read this file, so they can't drift apart. See
[ADR-0081](../../docs/adr/0081-mermaid-diagrams.md) and
[ADR-0082](../../docs/adr/0082-diagrams-in-canvas-exports.md). Changing it
changes what both accept: treat it as security policy.
