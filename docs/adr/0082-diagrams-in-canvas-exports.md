# ADR-0082 — Diagrams in canvas exports

Status: accepted. The shared diagram policy is implemented for US-105.1
(2026-11-25); the server renderer and the exports follow in US-105.2 and
US-105.3 ([EPIC-105](../epics/EPIC-105-DIAGRAMS-IN-CANVAS-EXPORTS.md)).

## Context

The app draws ` ```mermaid ` blocks as diagrams in the browser (ADR-0081).
Canvas DOCX and PDF downloads, the chat's canvas ZIP and Save to Files are made
on the server in Python (`domains/canvas/exports.py`), where every fence is
written as code. People who export a document with a diagram get its source,
not the picture.

Two facts shape the choice:

- The image already runs a headless Chromium for the web fetch tool
  (ADR-0065): one pooled browser, a fresh context per use, every request routed
  through the tool's own handler, and no network of its own.
- The runtime image already contains the frontend's production
  `node_modules`, mermaid and DOMPurify included, at the same path relative to
  the backend as in the repository.

## Decision: draw on the server, in the existing browser

The backend draws each mermaid block in the pooled Chromium, in a fresh context
where **every request is aborted**, from a static page holding mermaid's
standalone bundle and DOMPurify. The diagram source is the only content from
the document, passed as data rather than markup. The page draws with the locked
configuration and sanitizes with the same settings as the app, then the result
is captured as a PNG at 2× for both DOCX and PDF (Word's and fpdf2's SVG
support is too uneven to rely on). Rendering shares the fetch tool's browser
pool and semaphore, so it can't launch more browsers or starve the tool.

Considered and rejected:

- **A mermaid CLI or a Node service in the image:** a second headless browser
  and a second copy of mermaid to keep in step.
- **Rendering in the person's browser and uploading PNGs with the export:**
  every export path (single version, ZIP, Save to Files) would need a client
  round trip, and the server would have to trust and validate uploaded images.

## Decision: one diagram policy for the app and the server

The locked mermaid configuration, the sanitizer settings and the limits move
into a workspace package, `packages/diagram-policy` (`@asterism/diagram-policy`):

- `policy.json`: `mermaid` (the configuration and its `secure` list),
  `sanitizer` (profiles, allowed and forbidden tags and attributes, and the
  in-document `href` prefix), `renderTimeoutMs`, `png` and `labelLimits`.
- `print-theme.json`: mermaid `base` theme variables for exports, from the
  light Atlas palette. Exports use a fixed palette so a document looks the
  same for everyone. The file is generated from the app's
  `diagramThemeVariables`, and a frontend test fails if they ever differ.

The frontend imports the package (`workspace:*`). Its `policy.ts` deep-freezes
the policy and refuses to load unless `securityLevel` is `"strict"` and
`htmlLabels` is `false`. The image copies the package for the workspace install
and into the runtime stage, where the backend reads it.

`check:image` confirms, inside the container and as the runtime user, that the
policy, the print theme, mermaid's `dist/mermaid.min.js` and DOMPurify's
`dist/purify.min.js` are readable, and that the image's mermaid is exactly the
version the frontend pins. So the app and exports always draw with the same
mermaid and the same rules.

## Decision: bounded, accessible, nothing stored

- At most 30 diagrams per export, the shared 8 second limit for each and 60
  seconds for the whole export. Anything invalid, over a limit or failed exports
  as code with a short "Diagram not drawn" note.
- The picture's alt text is the diagram's `accTitle` and `accDescr` (DOCX
  picture description, PDF alt text), or "Diagram: <type>".
- Diagrams are drawn when the file is exported and not stored. Markdown and
  text downloads keep the source. No database change.

## Consequences

- Changing `packages/diagram-policy` changes what both the app and exports
  accept; it is security policy and is reviewed as such.
- Exports with diagrams take longer, and use the browser pool the fetch tool
  shares.
- Export text uses the fonts installed in the image, which can differ slightly
  from the app's system fonts.
