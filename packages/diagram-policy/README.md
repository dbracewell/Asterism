# @asterism/diagram-policy

The one copy of how Asterism draws mermaid diagrams from untrusted text:

- `mermaid`: the locked configuration passed to `mermaid.initialize`. Its
  `secure` list stops `%%{init}%%` directives and frontmatter from changing
  security, theme, font, CSS or label settings.
- `sanitizer`: the DOMPurify settings for the drawn SVG. `href` is kept only
  when it starts with `internalHrefPrefix`.
- `renderTimeoutMs`, `png` and `labelLimits`: time, size and name limits.
- `print-theme.json`: mermaid `base` theme variables for exported documents,
  from the light Atlas palette. It is generated from the app's
  `diagramThemeVariables`; a frontend test fails when they differ.

The app's markdown viewer (`apps/frontend/src/components/markdown-viewer`) and
the server's export renderer read this file, so they can't drift apart. See
[ADR-0081](../../docs/adr/0081-mermaid-diagrams.md) and
[ADR-0082](../../docs/adr/0082-diagrams-in-canvas-exports.md). Changing it
changes what both accept: treat it as security policy.
