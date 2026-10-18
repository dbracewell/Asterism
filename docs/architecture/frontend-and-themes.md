# Frontend layout, themes, and product surface

## Runtime ownership

The Next.js App Router owns authentication pages and the workspace shell.
`DashboardLayout` composes the sidebar, current-user context and page content.
Domain server data uses generated Hey API clients and TanStack Query; the shared
mutation cache owns normal invalidation. Settings sections load lazily and use
URL parameters to select the active section.

`RootLayout` loads theme metadata and CSS variables on the server, applying theme
colors and the font-size cookie to the root element. `ThemeProvider` exposes
selection helpers; cookies plus `router.refresh()` update server-rendered theme
state. `ThemeCheck` reconciles the logged-in user's saved appearance preferences
with those cookies. This is custom theme loading, not automatic OS dark-mode
selection. Syntax highlighting currently chooses VS/VS2015 by light/dark type.

## Theme files and editing

Bundled palettes live in [`features/theme/bundled`](../../apps/frontend/src/features/theme/bundled)
and are statically imported into the application. The theme repository composes
these read-only defaults with validated custom files under `STORAGE_ROOT/themes`.
Saving a bundled ID creates a persistent override; new palettes use server-generated
IDs. Each save writes and syncs a temporary file and atomically renames it into place.
Malformed files are isolated individually. No process-global palette cache exists.

Theme Editor uses an administrator-authorized server action and TanStack mutation.
Failures retain the draft with a retry action; success returns the persisted ID,
refreshes the catalog and resets dirty state. Public catalog APIs support setup,
sign-in and ordinary selection with `Cache-Control: no-store`. Missing custom IDs
resolve to Light without a saved-preference refresh loop.

See [theme storage and lifecycle](theme-storage.md) for schema, single-writer
ownership, backup/reset, container permissions and cache freshness. The
[theme trust boundary](auth-and-security.md#theme-trust-boundary) documents access.

## Layout and scrolling

Global CSS suppresses body overflow and the body uses `h-screen`. The workspace
relies on child panels owning scroll areas with shrinking flex content. This makes
`min-h-0`, `min-w-0` and explicit scroll ownership essential. Authentication does
not currently own a scroll area and clips setup controls in a short viewport.
Dialogs have caller-specific scroll limits rather than a universal height policy.
The file grid and Theme Editor retain fixed minimum dimensions needing narrow-pane
verification. Chat uses a fixed tail reserve beneath its floating composer.

The pending contract in [EPIC-32](../epics/EPIC-32-RESPONSIVE-LAYOUT-AND-REACHABILITY.md)
requires controls and final content to remain reachable across short/narrow windows,
nested panes, long content and enlarged text. `scrollWidth <= clientWidth` alone
cannot detect clipped vertical content or controls hidden by `overflow: hidden`.

## Theme and component consistency

Semantic variables cover text/surface, primary/secondary/muted/accent, destructive,
border/input/ring and sidebar roles. Chart defaults remain in global CSS rather
than the theme JSON contract. Shared shadcn components consume these variables;
some feature-level errors/statuses still use fixed colors. Focus and destructive
states use opacity, so raw token contrast measurements are only a first check.

The [dated review](../reviews/2026-10-17-codebase-review.md) records 12 failing
normal-text pairs across seven of eight bundled themes and palette-source links.
[EPIC-33](../epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md) owns corrections,
source attribution, composited-state checks, accessible labels, code typography
and reduced motion. Source fidelity permits documented accessibility adaptations.

## Current versus planned product surface

Providers/models, main/sub-agent settings, tool policy, theme editing and image
captioning have implementation paths, with limitations recorded above. Groups,
Users, Image Generation, Code Execution and Export settings currently render
placeholder text; their navigation is not evidence of an operational settings API.

The distinct persona/default-profile policy is not implemented by the main-agent
configuration in `agent_profiles`. Current chat composition passes no persona layer
and records `user_profile_id=None`. Typed memory namespace contracts exist, but
there is no active long-term memory engine or automatic cross-chat summaries.
[EPIC-35](../epics/EPIC-35-PRODUCT-SURFACE-AND-PERSONA-FOUNDATIONS.md) separates honest
navigation from the future persona foundation; memory activation needs separate work.

## Verification entry points

Use frontend unit tests for state/labels, the root isolated E2E runner for real
auth/backend/socket flows and fixture browser tests for targeted UI stress cases.
The runner requires ports 3000, 3100 and 8000 free and creates disposable storage.
Existing E2E coverage includes responsive provider/agent controls; a complete
theme/height/container matrix remains pending. See [scripts](../../scripts/README.md)
and the [review evidence](../reviews/2026-10-17-codebase-review.md).
