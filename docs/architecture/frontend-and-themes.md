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

## Rich-content trust

Main/user chat messages and sub-agent replies share `MarkdownViewer`. It disables
raw HTML, permits an explicit subset of link URLs, and renders Markdown images as
omitted-image text without loading them. KaTeX math uses `trust: false`, strict
validation and bounded size/expansion. Fenced code, GFM and scoped citations remain
supported. File extracted text/captions remain literal React text. See the
[Markdown and file-content policy](markdown-content.md) for the exact contract.

## Layout and scrolling

Global CSS suppresses body overflow and the body uses `h-screen`. The workspace
relies on child panels owning scroll areas with shrinking flex content. This makes
`min-h-0`, `min-w-0` and explicit scroll ownership essential. Authentication now
owns its own scroll area, described below. The workspace bounds its shell to
`100dvh`; its main inset scrolls ordinary pages while specialized panels retain
their own scroll areas. The mobile header stays full-width at the top.
Dialogs have caller-specific scroll limits rather than a universal height policy.
The file grid and Theme Editor retain fixed minimum dimensions needing narrow-pane
verification. Chat uses a fixed tail reserve beneath its floating composer.

The pending contract in [EPIC-32](../epics/EPIC-32-RESPONSIVE-LAYOUT-AND-REACHABILITY.md)
requires controls and final content to remain reachable across short/narrow windows,
nested panes, long content and enlarged text. `scrollWidth <= clientWidth` alone
cannot detect clipped vertical content or controls hidden by `overflow: hidden`.

### Authentication viewport and focus contract (US-32.1)

The `(auth)` route layout owns a `100dvh` scroll container with padding and scroll
padding. It uses vertical auto margins on the nonshrinking form: shorter forms
center, while taller forms start at the padded top and remain scrollable to the
last control. Form width/minimums and wrapping error text keep content within the
viewport without an authentication-level horizontal `hidden`/`clip` rule. The root
body rules remain unchanged.

The auth route exports `interactiveWidget: "resizes-content"` through Next.js
viewport metadata. Supporting browsers can resize the layout viewport when a
virtual keyboard opens; the route does not disable zoom or cap the scale. Browser
behavior is platform-dependent; see [Chrome's viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior).
Tests simulate reduced viewport sizes rather than certifying physical iOS/Android
keyboard behavior.

Auth errors use the existing semantic `FieldError`. A new or repeated error returns
focus to the summary and scrolls its start into view. It wraps unbroken server
messages, is described by the named form, and has a visible keyboard outline.
Tab continues from the summary through the fields to submit, preserving entered
values. The setup passkey label now targets the passkey input. Setup remains
available only with zero users; role/session checks and auth persistence are
unchanged.

Browser coverage exercises setup and login at 320/390px widths, 300/800px heights,
100%/200% root text size, and 640×300 landscape with both text sizes. It checks
keyboard order, focus rings and clearance, hit testing, actual wheel scroll and
touch submission, validation errors, a long message, viewport shrink/recovery and
successful login in disposable storage. See [verification evidence](../reviews/us-32.1-verification-2026-10-18.md).

### Mobile workspace shell

The dashboard uses a dynamic-height, nonshrinking sidebar provider and a shrinkable
main inset with vertical scrolling and an isolated page-content stacking context.
The mobile header is a full-width sticky grid:
its title cannot overlap the sidebar trigger, and both open/close controls have
44px touch targets. The sidebar uses a single click handler for touch, mouse and
keyboard activation, avoiding the former touch-end plus synthesized-click double
toggle. Mobile navigation closes the drawer; dismissal restores focus to the
trigger and releases the modal interaction lock. The mobile close button omits the
desktop expansion tooltip so Escape dismisses the drawer directly.

Sidebar navigation can scroll between its header and user footer. Ordinary project
and General pages scroll in the main inset; SettingsCard gives the selected pane
its own vertical scroll area. Project pagination wraps to avoid widening a narrow
page. The existing File Manager list and chat history retain local scrolling.
The mobile browser regression uses real authentication and production routes with
synthetic API content to check these owners, actual touch navigation and wheel
scrolling. Specialized narrow panes, tall dialogs, rich-content overflow and
composer clearance under expanded content remain the subsequent EPIC-32 stories.

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
