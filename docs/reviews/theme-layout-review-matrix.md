# Theme and layout review matrix

The automated review covers every JSON palette in `features/theme/bundled`.
Discovery is shared by the rendered contrast and layout specs; a unit test rejects
unregistered files, missing roles, unknown properties and invalid catalog IDs.
Custom saved themes remain user-controlled and are outside this bundled-theme gate.

## Automated layers

| Layer                                    | Coverage                                                                                                                                                                                                           | Failure evidence                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Frontend Vitest                          | Strict theme schema, catalog completeness, ten opaque text pairs per palette, known ratio and near-threshold calculation cases                                                                                     | Theme, role names, hex colors, unrounded ratio and required threshold                  |
| `theme-contrast.spec.ts`                 | All bundles; actual controls, primary/secondary/outline/destructive, badges, model selects in the composer panel, placeholders, selected/hover/invalid, keyboard rings, switch/checkbox                            | JSON compositing results and palette screenshot                                        |
| `theme-layout-matrix.spec.ts`            | All bundles in the three configurations below; named controls, hit testing, keyboard focus, select open/choose/return, monospace code/Montserrat wordmark, reduced motion, adversarial Markdown, horizontal bounds | Theme/viewport in test title, geometry and contrast JSON, screenshot; trace on failure |
| Existing auth/mobile/settings/chat specs | Real authenticated routes; setup and login, sidebar touch/close, tall dialogs, 240px file panes, growing composer, long tables/math/code and local scrolling                                                       | Existing screenshots and assertions, failure trace/screenshot                          |

Text-pair thresholds use the unrounded sRGB ratio: 4.5:1 for normal text; reviewed
control boundaries and focus indicators use 3:1. Browser probes resolve modern CSS
colors through canvas and composite ancestor backgrounds. The math follows the
[WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
It does not infer accessibility from a rounded displayed ratio or from screenshots.

| Matrix configuration      | Viewport | Pane  | Root text   | Motion  |
| ------------------------- | -------- | ----- | ----------- | ------- |
| Phone, short              | 320×300  | 320px | 16px        | Normal  |
| Desktop, narrow container | 1440×300 | 240px | 16px        | Reduced |
| Phone, enlarged text      | 390×600  | 390px | 32px (200%) | Reduced |

The fixture uses production components without substitute color CSS. Its named
container controls its layout independently of viewport width. Rich content has a
bounded local scroll region; code/tables/math retain their own keyboard scroll areas.
The pane and document must fit horizontally; passing document width alone is not
sufficient. Hit testing and ancestor clip rectangles catch covered or partially
clipped controls. The card and card-content widths are checked too, so a hidden
horizontal scroller cannot make a wide control appear reachable only after focus.
Tab strips and rich-content regions retain deliberate local scrolling; the last
tab is activated by keyboard in every configuration. Theme selectors/selected values
can shrink, and model capability badges wrap rather than widening their panel.
GFM-generated disabled task checkboxes are allowed; raw Markdown
inputs, forms, frames, scripts and resource elements remain forbidden.

## Run and inspect

From the repository root, with ports 3000, 3100 and 8000 free:

```bash
CI=1 pnpm_config_verify_deps_before_run=false UV_CACHE_DIR=/private/tmp/asterism-uv-cache node scripts/run-isolated-e2e.mjs --retries=0
# Focused fixture/contrast matrix, still using fresh isolated storage:
CI=1 pnpm_config_verify_deps_before_run=false UV_CACHE_DIR=/private/tmp/asterism-uv-cache node scripts/run-isolated-e2e.mjs theme-layout-matrix.spec.ts theme-contrast.spec.ts --retries=0
```

`pnpm test` includes the palette unit checks. Playwright defaults to zero retries;
CI also passes the explicit flag. The browser job always uploads the HTML report,
JSON reporter output and per-test evidence as `frontend-ui-review` for seven days,
including on failure. Locally, open `apps/frontend/playwright-report/index.html` or
inspect `apps/frontend/test-results`. These generated directories are gitignored.
The isolated runner uses synthetic accounts, API fixtures and disposable storage;
never point these artifact-producing runs at working user data.

## Manual review and exceptions

For a UI/theme change, inspect at least one light and one dark bundle in each
configuration above, then inspect the changed component across all bundles. Verify:

- Keyboard tab order, visible focus, Escape/return focus, touch hit areas and spacing.
- Loading, empty, failure/retry, unavailable selection, disabled and long-content states.
- 100% and 200% text, short height, narrow desktop panes, wheel/touch local scrolling;
  check actual mobile keyboard and screen-reader behavior on supported devices.
- Brand wordmark and icon rendering, syntax token readability, math layout, scrolling
  and reduced motion. Montserrat (`font-monsterrat`) remains the wordmark font.
- Custom themes and unusual translucent/opacity layers; these are not certified by
  the opaque paired-role gate. The browser color probe does not model group opacity,
  gradients, anti-aliasing, or arbitrary overlapping content.

There are no exceptions to the ten bundled text-pair checks. Disabled controls,
syntax palettes and branding are not silently treated as passing those checks:
they require manual review where the automated coverage does not measure them.
Any future exception must name the exact role/state/configuration, give a rationale
and supporting source/evidence, record an owner and review condition in this guide,
and appear in the verification report. Do not lower a shared threshold or hide an
overflow/focus failure to accommodate one component. This scoped review does not
claim whole-application WCAG conformance.
